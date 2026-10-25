import * as THREE from 'three';
import {
  IndexedProjectStore,
  MAX_CHARACTER_TEMPLATE_BYTES,
  validateCharacterTemplateRecord,
} from './ProjectStore.js';
import { validateTextureDimensions } from '../utils/device-profile.js';
import { getDevicePerformanceProfile, getDeviceMemoryGiB } from '../utils/device-profile.js';

const SUPPORTED_TYPES = new Set(['image/png', 'image/webp', 'image/jpeg']);
const MAX_INSTANCES = 50;
const DEFAULT_HEIGHT = 1.7;

/** World-space 2D characters: camera-facing sprites anchored at their feet in the 3D scene. */
export class WorldSpriteCharacterManager {
  constructor(scene, collisionManager, { characterRoster = null, onStateChange = () => {}, store = new IndexedProjectStore() } = {}) {
    this.scene = scene;
    this.collisionManager = collisionManager;
    this.characterRoster = characterRoster;
    this.onStateChange = onStateChange;
    this.store = store;
    this.templates = new Map();
    this.actors = [];
    this.selectedTemplateId = null;
    this.selectedId = null;
    this.nextId = 1;
    this.activeControl = false;
  }

  async loadLibrary() {
    const errors = [];
    const records = await this.store.listCharacterTemplateMetadata({ onInvalid: (record, error) => errors.push({ id: record?.id, message: error.message }) });
    for (const record of records) this.templates.set(record.id, record);
    for (const id of [...this.templates.keys()]) if (!records.some((record) => record.id === id)) this.templates.delete(id);
    const loaded = records.map(({ id }) => id);
    if (!this.templates.has(this.selectedTemplateId)) this.selectedTemplateId = loaded[0] || null;
    this._notify('library-loaded', errors);
    return this.listTemplates();
  }

  async addTemplate(file, { name = '', columns = 1, rows = 1, fps = 12 } = {}) {
    if (!file || !SUPPORTED_TYPES.has(file.type || '')) throw new Error('PNG, WebP veya JPEG spritesheet seçin.');
    if (!file.size || file.size > MAX_CHARACTER_TEMPLATE_BYTES) throw new Error('Spritesheet boş veya 50 MB sınırını aşıyor.');
    const profile = getDevicePerformanceProfile(getDeviceMemoryGiB());
    if (globalThis.navigator?.storage?.estimate) {
      const estimate = await globalThis.navigator.storage.estimate();
      if (Number.isFinite(estimate.quota) && Number.isFinite(estimate.usage)
        && estimate.usage + file.size > estimate.quota * 0.95) {
        throw new Error('Cihazın yerel depolama alanı dolmak üzere. Yer açıp yeniden deneyin.');
      }
    }
    const templateId = globalThis.crypto?.randomUUID?.() || `world2d-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const record = validateCharacterTemplateRecord({
      id: templateId,
      name: name || (file.name || '2D Karakter').replace(/\.(png|webp|jpe?g)$/i, ''),
      blob: file.slice(0, file.size, file.type),
      mimeType: file.type,
      fileName: file.name,
      columns,
      rows,
      fps,
    });
    const texture = await this._loadTexture(record.blob);
    const imageWidth = texture.image?.naturalWidth || texture.image?.width || 0;
    const imageHeight = texture.image?.naturalHeight || texture.image?.height || 0;
    try { validateTextureDimensions(imageWidth, imageHeight); }
    catch (error) { texture.dispose(); throw error; }
    if (!imageWidth || !imageHeight || imageWidth % record.columns || imageHeight % record.rows) {
      texture.dispose();
      throw new Error('Spritesheet boyutları seçilen satır ve sütunlara tam bölünmeli.');
    }
    texture.dispose();
    try {
      const saved = await this.store.saveCharacterTemplate(record, { maxLibraryBytes: profile.maxCharacterLibraryBytes });
      const { blob, ...metadata } = saved;
      this.templates.set(saved.id, { ...metadata, blobSize: blob.size, frameWidth: imageWidth / saved.columns, frameHeight: imageHeight / saved.rows });
      this.selectedTemplateId = saved.id;
      this._notify('template-added');
      return this.listTemplates().find((item) => item.id === saved.id);
    } catch (error) {
      texture.dispose();
      throw error;
    }
  }

  async deleteTemplate(id = this.selectedTemplateId) {
    const template = this.templates.get(id);
    if (!template) return false;
    if (this.actors.some((actor) => actor.templateId === id)) throw new Error('Bu spritesheet sahnedeki karakterler tarafından kullanılıyor. Önce karakterleri kaldırın.');
    await this.store.deleteCharacterTemplate(id);
    this.templates.delete(id);
    this.selectedTemplateId = this.templates.keys().next().value || null;
    this._notify('template-removed');
    return true;
  }

  selectTemplate(id) {
    if (!this.templates.has(id)) return false;
    this.selectedTemplateId = id;
    this._notify('template-selected');
    return true;
  }

  listTemplates() {
    return [...this.templates.values()].map(({ id, name, columns, rows, fps, fileName }) => ({ id, name, columns, rows, fps, fileName }));
  }

  async spawn(templateId = this.selectedTemplateId, position = null) {
    const template = this.templates.get(templateId);
    if (!template) throw new Error('Önce 2D karakter kitaplığından bir spritesheet seçin.');
    if (this.actors.length >= MAX_INSTANCES) throw new Error(`En fazla ${MAX_INSTANCES} dünya karakteri oluşturulabilir.`);

    const record = this.store.getCharacterTemplate ? await this.store.getCharacterTemplate(templateId) : null;
    if (!record && !template.texture) throw new Error(`“${template.name}” için kayıtlı spritesheet bulunamadı.`);
    const texture = record ? await this._loadTexture(record.blob) : template.texture.clone();
    const imageWidth = texture.image?.naturalWidth || texture.image?.width || 0;
    const imageHeight = texture.image?.naturalHeight || texture.image?.height || 0;
    try { validateTextureDimensions(imageWidth, imageHeight); }
    catch (error) { texture.dispose(); throw error; }
    if (!imageWidth || !imageHeight || imageWidth % template.columns || imageHeight % template.rows) {
      texture.dispose();
      throw new Error('Spritesheet boyutları kitaplık kaydıyla eşleşmiyor.');
    }
    template.frameWidth = imageWidth / template.columns;
    template.frameHeight = imageHeight / template.rows;
    this._configureTexture(texture, template.columns, template.rows);

    const selected3D = this.characterRoster?.selectedCharacter?.getPosition?.() || new THREE.Vector3();
    const spawn = position ? new THREE.Vector3(position.x, position.y || 0, position.z) : new THREE.Vector3(selected3D.x + 1.6 + (this.actors.length % 3) * 0.8, selected3D.y, selected3D.z);
    spawn.y = this.collisionManager?.getFloorHeight(spawn, spawn.y) ?? spawn.y;

    this._setTextureFrame(texture, template.columns, template.rows, 0);
    const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: true, depthWrite: false, toneMapped: false });
    const sprite = new THREE.Sprite(material);
    sprite.center.set(0.5, 0);
    sprite.renderOrder = 1;
    const aspect = (template.frameWidth || (texture.image.width / template.columns)) / (template.frameHeight || (texture.image.height / template.rows));
    const height = DEFAULT_HEIGHT;
    const collisionRadius = Math.max(0.2, Math.min(0.75, height * aspect * 0.22));
    if (this.collisionManager) {
      spawn.copy(this.collisionManager.clampTargetOutsideObstacles(spawn, collisionRadius));
      spawn.y = this.collisionManager.getFloorHeight(spawn, spawn.y);
    }
    if (!position) {
      let foundSpawn = false;
      const colliderShape = { collisionRadius, characterHeight: height };
      for (let attempt = 0; attempt < 24; attempt++) {
        const ring = 1.6 + Math.floor(attempt / 8) * 0.9;
        const angle = (attempt % 8) * Math.PI / 4;
        const candidate = new THREE.Vector3(selected3D.x + Math.cos(angle) * ring, selected3D.y, selected3D.z + Math.sin(angle) * ring);
        if (this.collisionManager) {
          candidate.copy(this.collisionManager.clampTargetOutsideObstacles(candidate, collisionRadius));
          candidate.y = this.collisionManager.getFloorHeight(candidate, selected3D.y);
        }
        if (!this._overlapsActor(colliderShape, candidate)) {
          spawn.copy(candidate);
          foundSpawn = true;
          break;
        }
      }
      if (!foundSpawn) {
        texture.dispose();
        throw new Error('Yakında boş bir 2D karakter başlangıç noktası bulunamadı.');
      }
    }
    sprite.scale.set(height * aspect, height, 1);
    sprite.position.copy(spawn);
    this.scene.add(sprite);

    const collider = new THREE.Mesh(
      new THREE.BoxGeometry(collisionRadius * 2, height, collisionRadius * 2),
      new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false, depthTest: false })
    );
    collider.position.set(spawn.x, spawn.y + height / 2, spawn.z);
    collider.userData.isWorldSpriteCollider = true;
    collider.castShadow = false;
    collider.receiveShadow = false;
    this.scene.add(collider);
    this.collisionManager?.registerObstacle?.(collider);

    const index = this.nextId++;
    const actor = {
      id: `world2d-${index}`,
      name: `${template.name} ${index}`,
      templateId,
      sprite,
      collider,
      texture,
      position: sprite.position,
      target: null,
      collisionRadius,
      characterHeight: height,
      walkSpeed: 3.2,
      fps: template.fps,
      columns: template.columns,
      rows: template.rows,
      frameCount: template.columns * template.rows,
      frame: 0,
      frameElapsed: 0,
      isMoving: false,
    };
    this.actors.push(actor);
    this.selectedId = actor.id;
    this._notify('actor-added');
    return actor;
  }

  listActors() {
    return this.actors.map(({ id, name, templateId, position, isMoving }) => ({ id, name, templateId, x: position.x, y: position.y, z: position.z, isMoving }));
  }

  async exportProjectStateForStorage() {
    const actorRecords = this.listActors().map(({ id, name, templateId, x, y, z }) => ({ id, name, templateId, x, y, z }));
    const usedIds = [...new Set(actorRecords.map((actor) => actor.templateId))];
    const templates = [];
    for (const id of usedIds) {
      const record = await this.store.getCharacterTemplate(id);
      if (!record) throw new Error(`“${id}” karakterinin kaynak spritesheet'i kitaplıkta bulunamadı; sahne kaydedilemedi.`);
      templates.push(record);
    }
    return { templates, actors: actorRecords };
  }

  async importProjectState({ templates = [], actors = [] } = {}, { replaceTemplates = false } = {}) {
    const stagedTemplates = [];
    for (const source of templates) {
      const record = validateCharacterTemplateRecord(source);
      const existing = this.templates.get(record.id);
      if (!replaceTemplates && existing && existing.name === record.name && existing.columns === record.columns
        && existing.rows === record.rows && existing.fps === record.fps && existing.fileName === record.fileName
        && existing.blobSize === record.blob.size) continue;
      const texture = await this._loadTexture(record.blob);
      const width = texture.image?.naturalWidth || texture.image?.width || 0;
      const height = texture.image?.naturalHeight || texture.image?.height || 0;
      try {
        validateTextureDimensions(width, height);
        if (!width || !height || width % record.columns || height % record.rows) throw new Error('Spritesheet satır/sütun yapısı görselle eşleşmiyor.');
      } finally { texture.dispose(); }
      stagedTemplates.push(record);
    }
    for (const record of stagedTemplates) {
      const saved = await this.store.saveCharacterTemplate(record, {
        maxLibraryBytes: getDevicePerformanceProfile(getDeviceMemoryGiB()).maxCharacterLibraryBytes,
      });
      const { blob, ...metadata } = saved;
      this.templates.set(saved.id, { ...metadata, blobSize: blob.size });
    }

    const scratchScene = new THREE.Scene();
    const staging = new WorldSpriteCharacterManager(scratchScene, null, { store: this.store });
    staging.templates = this.templates;
    staging._loadTexture = (...args) => this._loadTexture(...args);
    try {
      for (const source of actors) {
        const actor = await staging.spawn(source.templateId, { x: Number(source.x), y: Number(source.y), z: Number(source.z) });
        actor.id = source.id;
        actor.name = source.name;
        staging.nextId = Math.max(staging.nextId, Number(source.id.match(/(\d+)$/)?.[1] || 0) + 1);
        staging.selectedId = actor.id;
      }
    } catch (error) {
      for (const actor of [...staging.actors]) staging._disposeActor(actor);
      staging.actors = [];
      throw error;
    }

    for (const actor of [...this.actors]) this._disposeActor(actor);
    this.actors = staging.actors;
    staging.actors = [];
    this.nextId = Math.max(1, staging.nextId);
    this.selectedId = this.actors.at(-1)?.id || null;
    this.activeControl = false;
    for (const actor of this.actors) {
      scratchScene.remove(actor.sprite);
      scratchScene.remove(actor.collider);
      this.scene.add(actor.sprite);
      this.scene.add(actor.collider);
      this.collisionManager?.registerObstacle?.(actor.collider);
    }
    this._notify('instances-restored');
    return this.listActors();
  }

  select(id) {
    if (!this.actors.some((actor) => actor.id === id)) return false;
    this.selectedId = id;
    this._notify('actor-selected');
    return true;
  }

  getActor(id = this.selectedId) { return this.actors.find((actor) => actor.id === id) || null; }
  getActorForSprite(sprite) { return this.actors.find((actor) => actor.sprite === sprite) || null; }

  setControlMode(enabled) {
    this.activeControl = Boolean(enabled);
    if (!this.activeControl) this.stopSelected();
    this._notify('control-mode');
  }

  moveSelectedTo(point) {
    const actor = this.getActor();
    if (!actor || !point) return false;
    let target = new THREE.Vector3(Number(point.x), Number(point.y) || 0, Number(point.z));
    if (this.collisionManager) {
      target = this.collisionManager.clampTargetOutsideObstacles(target, actor.collisionRadius);
      target.y = this.collisionManager.getFloorHeight(target, actor.position.y);
    }
    actor.target = target;
    actor.isMoving = true;
    this._notify('actor-moving');
    return true;
  }

  stopSelected() {
    const actor = this.getActor();
    if (!actor) return false;
    actor.target = null;
    actor.isMoving = false;
    this._setFrame(actor, 0);
    this._notify('actor-stopped');
    return true;
  }

  remove(id = this.selectedId) {
    const index = this.actors.findIndex((actor) => actor.id === id);
    if (index < 0) return false;
    const [actor] = this.actors.splice(index, 1);
    this._disposeActor(actor);
    if (this.actors.length === 0) this.activeControl = false;
    if (this.selectedId === id) this.selectedId = this.actors[Math.max(0, index - 1)]?.id || null;
    this._notify('actor-removed');
    return true;
  }

  _disposeActor(actor) {
    this.scene.remove(actor.sprite);
    this.scene.remove(actor.collider);
    this.collisionManager?.unregisterObstacle?.(actor.collider);
    actor.collider.geometry.dispose();
    actor.collider.material.dispose();
    actor.texture.dispose();
    actor.sprite.material.dispose();
  }

  update(delta) {
    const dt = Math.max(0, Math.min(Number(delta) || 0, 0.1));
    for (const actor of this.actors) {
      actor.frameElapsed += dt;
      if (actor.isMoving && actor.frameCount > 1 && actor.frameElapsed >= 1 / actor.fps) {
        const advances = Math.floor(actor.frameElapsed * actor.fps);
        actor.frameElapsed -= advances / actor.fps;
        this._setFrame(actor, (actor.frame + advances) % actor.frameCount);
      }
      if (!actor.target || !actor.isMoving) continue;
      const dx = actor.target.x - actor.position.x;
      const dz = actor.target.z - actor.position.z;
      const distance = Math.hypot(dx, dz);
      if (distance < 0.06) {
        actor.position.x = actor.target.x;
        actor.position.z = actor.target.z;
        actor.position.y = actor.target.y;
        actor.collider.position.set(actor.position.x, actor.position.y + actor.characterHeight / 2, actor.position.z);
        this.collisionManager?.registerObstacle?.(actor.collider);
        actor.target = null;
        actor.isMoving = false;
        this._setFrame(actor, 0);
        this._notify('actor-arrived');
        continue;
      }
      const stepDistance = Math.min(distance, actor.walkSpeed * dt);
      const step = new THREE.Vector3(dx / distance * stepDistance, 0, dz / distance * stepDistance);
      if (this.collisionManager) {
        step.copy(this.collisionManager.resolveMovement(actor.position, step, actor.collisionRadius, actor.characterHeight, actor.collider).resolvedStep);
      }
      const candidate = actor.position.clone().add(step);
      if (this._overlapsActor(actor, candidate)) {
        actor.target = null;
        actor.isMoving = false;
        this._setFrame(actor, 0);
        this._notify('actor-blocked');
        continue;
      }
      actor.position.x = candidate.x;
      actor.position.z = candidate.z;
      if (this.collisionManager) actor.position.y = this.collisionManager.getFloorHeight(actor.position, actor.position.y);
      actor.collider.position.set(actor.position.x, actor.position.y + actor.characterHeight / 2, actor.position.z);
      this.collisionManager?.registerObstacle?.(actor.collider);
      // THREE.Sprite remains camera-facing; its feet stay anchored to the world position.
      if (step.lengthSq() < 0.000001 && distance > 0.06) {
        actor.target = null;
        actor.isMoving = false;
        this._setFrame(actor, 0);
        this._notify('actor-blocked');
      }
    }
  }

  dispose() {
    for (const actor of [...this.actors]) this.remove(actor.id);
    for (const template of this.templates.values()) template.texture?.dispose();
    this.templates.clear();
  }

  async _loadTexture(blob) {
    const objectUrl = URL.createObjectURL(blob);
    try {
      return await new Promise((resolve, reject) => new THREE.TextureLoader().load(objectUrl, resolve, undefined, reject));
    } catch (error) {
      throw new Error(`2D karakter görseli okunamadı: ${error.message || 'dosya hatalı'}`);
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
  }

  _configureTexture(texture, columns, rows) {
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.magFilter = THREE.NearestFilter;
    texture.minFilter = THREE.NearestFilter;
    texture.generateMipmaps = false;
    texture.repeat.set(1 / columns, 1 / rows);
    texture.needsUpdate = true;
  }

  _setTextureFrame(texture, columns, rows, frame) {
    const column = frame % columns;
    const row = Math.floor(frame / columns);
    texture.offset.set(column / columns, 1 - (row + 1) / rows);
    texture.needsUpdate = true;
  }

  _setFrame(actor, frame) {
    actor.frame = Math.max(0, Math.min(actor.frameCount - 1, Math.floor(frame)));
    this._setTextureFrame(actor.texture, actor.columns, actor.rows, actor.frame);
  }

  _overlapsActor(actor, candidate) {
    const overlaps = (otherPosition, otherRadius, otherHeight) => {
      const vertical = candidate.y < otherPosition.y + otherHeight && candidate.y + actor.characterHeight > otherPosition.y;
      return vertical && Math.hypot(candidate.x - otherPosition.x, candidate.z - otherPosition.z) < actor.collisionRadius + otherRadius - 0.001;
    };
    if (this.actors.some((other) => other !== actor && overlaps(other.position, other.collisionRadius, other.characterHeight))) return true;
    const rosterActors = this.characterRoster?.actors || [];
    return rosterActors.some(({ character }) => overlaps(character.rootGroup.position, character.collisionRadius, character.characterHeight));
  }

  _notify(type, errors = []) {
    this.onStateChange({ type, errors, templates: this.listTemplates(), actors: this.listActors(), selectedId: this.selectedId, selectedTemplateId: this.selectedTemplateId, activeControl: this.activeControl });
  }
}
