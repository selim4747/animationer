import { Character } from './Character.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const COLORS = [0xf4f4f4, 0xc9c9c9, 0x9e9e9e, 0x777777, 0xffffff];

/** Manages selectable procedural actors while preserving a selected-character facade. */
export class CharacterRoster {
  constructor(scene, collisionManager, onChange = () => {}, store = null) {
    this.scene = scene;
    this.collisionManager = collisionManager;
    this.onChange = onChange;
    this.store = store;
    this.actors = [];
    this.selectedId = null;
    this.nextId = 1;
    this.addCharacter('Karakter 1', { x: 0, y: 0, z: 0 });
  }

  get selectedCharacter() {
    return this.getCharacter(this.selectedId) || this.actors[0]?.character || null;
  }

  getCharacter(id = this.selectedId) {
    return this.actors.find((actor) => actor.id === id)?.character || null;
  }

  getActor(id = this.selectedId) {
    return this.actors.find((actor) => actor.id === id) || null;
  }

  list() {
    return this.actors.map(({ id, name, character }) => ({
      id,
      name,
      visible: character.rootGroup.visible,
      isMoving: character.isMoving,
      selected: id === this.selectedId,
    }));
  }

  addCharacter(name, position = null) {
    if (this.actors.length >= 20) throw new Error('En fazla 20 karakter eklenebilir.');
    const spawn = position ? { ...position } : this._findFreeSpawn();
    const index = this.nextId++;
    const id = `character-${index}`;
    const character = new Character(this.scene, this.collisionManager, (state) => {
      this.onChange({ type: 'state', id, state, actors: this.list() });
    });
    character.rootGroup.name = id;
    character.bodyMesh.material.color.setHex(COLORS[(index - 1) % COLORS.length]);
    character.teleportTo(spawn.x, spawn.y, spawn.z);
    const actor = { id, name: name || `Karakter ${index}`, character, modelId: null };
    this.actors.push(actor);
    if (!this.selectedId) this.selectedId = id;
    this._syncSelectedAppearance();
    this.onChange({ type: 'added', id, actors: this.list() });
    return actor;
  }

  _findFreeSpawn() {
    const reference = this.selectedCharacter?.getPosition?.() || { x: 0, y: 0, z: 0 };
    this.collisionManager?.updateObstacleBoxes?.();
    const radius = 0.42;
    const candidates = [];
    for (let ring = 1; ring <= 8; ring++) {
      const distance = 1.35 + (ring - 1) * 0.7;
      const count = Math.max(8, ring * 8);
      for (let index = 0; index < count; index++) {
        const angle = index * Math.PI * 2 / count;
        candidates.push({ x: reference.x + Math.cos(angle) * distance, y: reference.y, z: reference.z + Math.sin(angle) * distance });
      }
    }
    const isFree = (point) => {
      if (this.actors.some(({ character }) => {
        if (!character.rootGroup.visible || Math.abs(character.getPosition().y - point.y) > character.characterHeight) return false;
        return Math.hypot(character.getPosition().x - point.x, character.getPosition().z - point.z) < radius + character.collisionRadius;
      })) return false;
      return !(this.collisionManager?.registeredObstacles || []).some(({ object, box }) => {
        if (!object || object.visible === false || !box) return false;
        if (box.max.y < point.y + 0.1 || box.min.y > point.y + 1.6) return false;
        const x = Math.max(box.min.x, Math.min(point.x, box.max.x));
        const z = Math.max(box.min.z, Math.min(point.z, box.max.z));
        return (point.x - x) ** 2 + (point.z - z) ** 2 < radius ** 2;
      });
    };
    const spawn = candidates.find(isFree);
    if (!spawn) throw new Error('Yakın çevrede boş karakter doğma noktası bulunamadı. Engelleri kaldırıp yeniden deneyin.');
    return spawn;
  }

  async loadCharacterFile(file) {
    if (!file || !/\.glb$/i.test(file.name || '')) {
      throw new Error('Yalnızca .glb karakter dosyaları desteklenir.');
    }
    if (file.size > 50 * 1024 * 1024) throw new Error('Karakter dosyası 50 MB sınırını aşamaz.');
    if (this.actors.length >= 20) throw new Error('En fazla 20 karakter eklenebilir.');

    const name = (file.name || 'Yüklenen karakter').replace(/\.glb$/i, '').slice(0, 48);
    const blob = file.slice(0, file.size, file.type || 'model/gltf-binary');
    const gltf = await this._parseModelBlob(blob);
    const model = this.store?.saveCharacterModel
      ? await this.store.saveCharacterModel({
        id: globalThis.crypto?.randomUUID?.() || `character-model-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        name: name || 'Yüklenen karakter', blob, mimeType: blob.type, fileName: file.name,
      })
      : null;
    return this._addParsedModel(gltf, { name: name || 'Yüklenen karakter', modelId: model?.id || null });
  }

  async _parseModelBlob(blob) {
    const loader = new GLTFLoader();
    const buffer = await blob.arrayBuffer();
    const gltf = await new Promise((resolve, reject) => loader.parse(buffer, '', resolve, reject));
    if (!gltf?.scene) throw new Error('GLB dosyasından sahne okunamadı.');
    return gltf;
  }

  async loadCharacterModel(modelId) {
    const model = await this.store?.getCharacterModel?.(modelId);
    if (!model) throw new Error('3D karakter kitaplığındaki model bulunamadı.');
    if (this.actors.length >= 20) throw new Error('En fazla 20 karakter eklenebilir.');
    const gltf = await this._parseModelBlob(model.blob);
    return this._addParsedModel(gltf, { name: model.name, modelId: model.id });
  }

  _addParsedModel(gltf, { name, modelId = null, position = null } = {}) {
    if (!gltf?.scene) throw new Error('GLB dosyasından sahne okunamadı.');
    const actor = this.addCharacter(name || 'Yüklenen karakter', position);
    try {
      actor.character.setModel(gltf.scene, gltf.animations || []);
      actor.modelId = modelId;
      this.select(actor.id);
      return actor;
    } catch (error) {
      this.removeCharacter(actor.id);
      throw error;
    }
  }

  exportProjectStateForStorage() {
    return {
      selectedId: this.selectedId,
      actors: this.actors.map(({ id, name, modelId, character }) => ({
        id,
        name,
        modelId: modelId || null,
        position: { x: character.rootGroup.position.x, y: character.rootGroup.position.y, z: character.rootGroup.position.z },
        rotationY: character.rootGroup.rotation.y,
        walkSpeed: character.walkSpeed,
        wobbleIntensity: character.wobbleIntensity,
        visible: character.rootGroup.visible,
      })),
    };
  }

  async restoreProjectState(state = {}) {
    const actors = Array.isArray(state.actors) ? state.actors : [];
    if (actors.length > 20) throw new Error('Projede 20’den fazla 3D karakter var.');
    if (!actors.length) {
      if (!this.actors.length) this.addCharacter('Karakter 1', { x: 0, y: 0, z: 0 });
      return this.list();
    }
    const stagingScene = new this.scene.constructor();
    const staging = new CharacterRoster(stagingScene, this.collisionManager, () => {}, this.store);
    for (const actor of [...staging.actors]) staging._disposeActor(actor);
    staging.actors = [];
    staging.selectedId = null;
    staging.nextId = 1;
    try {
      for (const source of actors) {
        if (!source || typeof source.id !== 'string' || !source.id) throw new Error('3D karakter kimliği geçersiz.');
        const position = source.position || { x: source.x || 0, y: source.y || 0, z: source.z || 0 };
        const actor = staging.addCharacter(String(source.name || 'Karakter').slice(0, 48), position);
        const createdId = actor.id;
        actor.id = source.id;
        actor.character.rootGroup.name = source.id;
        actor.modelId = typeof source.modelId === 'string' ? source.modelId : null;
        if (actor.modelId) {
          const model = await this.store?.getCharacterModel?.(actor.modelId);
          if (!model) throw new Error(`“${source.name || source.id}” karakterinin 3D kaynak modeli kitaplıkta bulunamadı.`);
          const gltf = await this._parseModelBlob(model.blob);
          actor.character.setModel(gltf.scene, gltf.animations || []);
        }
        actor.character.rootGroup.position.set(Number(position.x) || 0, Number(position.y) || 0, Number(position.z) || 0);
        actor.character.targetPosition.copy(actor.character.rootGroup.position);
        actor.character.rootGroup.rotation.y = Number(source.rotationY) || 0;
        actor.character.walkSpeed = Math.max(1, Math.min(10, Number(source.walkSpeed) || 4.2));
        actor.character.wobbleIntensity = Math.max(0, Math.min(2, Number(source.wobbleIntensity) || 0));
        actor.character.setVisible(source.visible !== false);
        staging.nextId = Math.max(staging.nextId, Number(source.id.match(/(\d+)$/)?.[1] || 0) + 1);
        if (!staging.selectedId || source.id === state.selectedId) staging.selectedId = source.id;
        // addCharacter's state callback captured its generated ID; replace it with the persisted ID.
        actor.character.onStateChange = (detail) => staging.onChange({ type: 'state', id: actor.id, state: detail, actors: staging.list() });
        if (createdId !== source.id) staging.actors[staging.actors.length - 1].id = source.id;
      }
    } catch (error) {
      for (const actor of [...staging.actors]) staging._disposeActor(actor);
      throw error;
    }

    for (const actor of [...this.actors]) this._disposeActor(actor);
    this.actors = staging.actors;
    this.selectedId = this.actors.some((actor) => actor.id === state.selectedId) ? state.selectedId : (this.actors[0]?.id || null);
    this.nextId = Math.max(1, staging.nextId);
    for (const actor of this.actors) {
      stagingScene.remove(actor.character.rootGroup, actor.character.targetMarker);
      this.scene.add(actor.character.rootGroup, actor.character.targetMarker);
      actor.character.scene = this.scene;
      actor.character.collisionManager = this.collisionManager;
      actor.character.onStateChange = (detail) => this.onChange({ type: 'state', id: actor.id, state: detail, actors: this.list() });
    }
    staging.actors = [];
    this._syncSelectedAppearance();
    this.onChange({ type: 'restored', actors: this.list() });
    return this.list();
  }

  _disposeActor(actor) {
    if (!actor?.character) return;
    actor.character.stopMotion();
    this.scene.remove(actor.character.rootGroup, actor.character.targetMarker);
    actor.character.targetMarker.geometry?.dispose?.();
    actor.character.targetMarker.material?.dispose?.();
    actor.character.rootGroup.traverse((object) => {
      object.geometry?.dispose?.();
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of materials) {
        if (!material) continue;
        for (const value of Object.values(material)) if (value?.isTexture) value.dispose();
        material.dispose();
      }
    });
  }

  select(id) {
    if (!this.actors.some((actor) => actor.id === id)) return false;
    if (this.selectedId && this.selectedId !== id) this.getCharacter(this.selectedId)?.setControlVector(0, 0);
    this.selectedId = id;
    this._syncSelectedAppearance();
    this.onChange({ type: 'selected', id, actors: this.list() });
    return true;
  }

  removeCharacter(id = this.selectedId) {
    if (this.actors.length <= 1) return false;
    const index = this.actors.findIndex((actor) => actor.id === id);
    if (index < 0) return false;
    const [actor] = this.actors.splice(index, 1);
    this._disposeActor(actor);
    if (this.selectedId === id) this.selectedId = this.actors[Math.max(0, index - 1)].id;
    this._syncSelectedAppearance();
    this.onChange({ type: 'removed', id, actors: this.list() });
    return true;
  }

  update(delta) {
    for (const actor of this.actors) {
      actor.character.update(delta);
      const position = actor.character.rootGroup.position;
      if (!actor._lastStoredPosition) actor._lastStoredPosition = position.clone();
      else if (!actor.character.isMoving && actor._lastStoredPosition.distanceToSquared(position) > 0.0004) {
        actor._lastStoredPosition.copy(position);
        this.onChange({ type: 'actor-position', id: actor.id, actors: this.list() });
      }
    }
  }

  getPosition() { return this.selectedCharacter.getPosition(); }
  moveTo(point) { return this.selectedCharacter.moveTo(point); }
  moveToPromise(point, options) { return this.selectedCharacter.moveToPromise(point, options); }
  playEmotePromise(type) { return this.selectedCharacter.playEmotePromise(type); }
  setSpeed(speed) { return this.selectedCharacter.setSpeed(speed); }
  setWobbleIntensity(value) { return this.selectedCharacter.setWobbleIntensity(value); }
  teleportTo(x, y, z) { return this.selectedCharacter.teleportTo(x, y, z); }
  setControlVector(x, z) { return this.selectedCharacter.setControlVector(x, z); }

  followCharacter(followerId, targetId, options) {
    const follower = this.getCharacter(followerId);
    const target = this.getCharacter(targetId);
    if (!follower || !target || follower === target) return Promise.resolve(false);
    return follower.startFollowing(target, options);
  }

  setVisible(id, visible) {
    const character = this.getCharacter(id);
    if (!character) return false;
    character.setVisible(visible);
    this.onChange({ type: 'visibility', id, actors: this.list() });
    return true;
  }

  setDirectControlForSelected(x, z) { this.setControlVector(x, z); }

  _syncSelectedAppearance() {
    for (const actor of this.actors) {
      const active = actor.id === this.selectedId;
      actor.character.bodyMesh.material.emissive?.setHex(active ? 0x252525 : 0x000000);
      actor.character.targetMarker.material.color.setHex(active ? 0xffffff : 0x888888);
    }
  }

  pauseAll(paused) {
    for (const actor of this.actors) actor.character.setTimelinePaused(paused);
  }

  stopAllMotions() {
    for (const actor of this.actors) actor.character.stopMotion();
  }
}
