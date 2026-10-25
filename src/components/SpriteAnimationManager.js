import * as THREE from 'three';
import { getDeviceMemoryGiB, getDevicePerformanceProfile } from '../utils/device-profile.js';
import { validateTextureDimensions } from '../utils/device-profile.js';

const MAX_FILE_SIZE = 50 * 1024 * 1024;
export const MAX_PROJECT_ASSET_EXPORT_BYTES = 50 * 1024 * 1024;

/** Screen-space 2D sprites rendered on a transparent Three.js overlay scene. */
export class SpriteAnimationManager {
  constructor(scene, { width = window.innerWidth, height = window.innerHeight, onStateChange = () => {} } = {}) {
    this.scene = scene;
    this.width = width;
    this.height = height;
    this.onStateChange = onStateChange;
    this.actors = [];
    this.selectedId = null;
    this.nextId = 1;
    this.isPaused = false;
  }

  async addSpriteSheet(file, { columns = 1, rows = 1, fps = 12 } = {}) {
    if (!file || !/^image\/(png|webp|jpeg)$/.test(file.type || '')) {
      throw new Error('PNG, WebP veya JPEG spritesheet seçin.');
    }
    if (file.size > MAX_FILE_SIZE) throw new Error('Spritesheet en fazla 50 MB olabilir.');
    columns = Number(columns);
    rows = Number(rows);
    fps = Number(fps);
    if (!Number.isInteger(columns) || columns < 1 || columns > 64 || !Number.isInteger(rows) || rows < 1 || rows > 64 || columns * rows > 4096) {
      throw new Error('Satır/sütun sayısı geçersiz (en fazla 4096 kare).');
    }
    if (!Number.isFinite(fps) || fps < 1 || fps > 60) throw new Error('FPS 1–60 arasında olmalı.');

    const objectUrl = URL.createObjectURL(file);
    let texture;
    try {
      texture = await this._loadTexture(objectUrl);
    } catch (error) {
      URL.revokeObjectURL(objectUrl);
      throw new Error(`Spritesheet okunamadı: ${error.message || 'görsel formatı hatalı'}`);
    }
    URL.revokeObjectURL(objectUrl);

    const imageWidth = texture.image?.naturalWidth || texture.image?.width || 0;
    const imageHeight = texture.image?.naturalHeight || texture.image?.height || 0;
    try { validateTextureDimensions(imageWidth, imageHeight); }
    catch (error) { texture.dispose(); throw error; }
    if (!imageWidth || !imageHeight || imageWidth % columns || imageHeight % rows) {
      texture.dispose();
      throw new Error('Görsel boyutları seçilen satır ve sütunlara tam bölünmeli.');
    }

    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.magFilter = THREE.NearestFilter;
    texture.minFilter = THREE.NearestFilter;
    texture.generateMipmaps = false;
    texture.repeat.set(1 / columns, 1 / rows);
    texture.needsUpdate = true;

    const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false, depthWrite: false, toneMapped: false });
    const sprite = new THREE.Sprite(material);
    sprite.renderOrder = 1000;
    const frameWidth = imageWidth / columns;
    const frameHeight = imageHeight / rows;
    const height = Math.min(180, Math.max(32, frameHeight));
    const x = this.width * 0.5;
    const y = this.height * 0.36;
    sprite.scale.set(height * (frameWidth / frameHeight), height, 1);

    const actor = {
      id: `sprite-${this.nextId++}`,
      name: (file.name || 'Spritesheet').replace(/\.(png|webp|jpe?g)$/i, '').slice(0, 48),
      sprite,
      texture,
      columns,
      rows,
      frameCount: columns * rows,
      frameWidth,
      frameHeight,
      frame: 0,
      fps,
      x,
      y,
      displayHeight: height,
      isPlaying: false,
      loop: true,
      playbackElapsed: 0,
      frameProgress: 0,
      duration: null,
      resolver: null,
      sourceFile: file,
    };
    this._setFrame(actor, 0);
    this._setPosition(actor);
    this.scene.add(sprite);
    this.actors.push(actor);
    this.selectedId = actor.id;
    this._notify('added', actor);
    return actor;
  }

  _loadTexture(url) {
    return new Promise((resolve, reject) => {
      new THREE.TextureLoader().load(url, resolve, undefined, reject);
    });
  }

  hitTest(x, y) {
    for (let index = this.actors.length - 1; index >= 0; index--) {
      const actor = this.actors[index];
      const width = actor.displayHeight * (actor.frameWidth / actor.frameHeight);
      if (Math.abs(x - actor.x) <= width / 2 && Math.abs(y - actor.y) <= actor.displayHeight / 2) return actor;
    }
    return null;
  }
  async exportAssets() {
    const exportLimit = Math.min(
      MAX_PROJECT_ASSET_EXPORT_BYTES,
      getDevicePerformanceProfile(getDeviceMemoryGiB()).maxProjectAssetExportBytes,
    );
    const totalBytes = this.actors.reduce((total, actor) => total + (actor.sourceFile?.size || 0), 0);
    if (totalBytes > exportLimit) {
      throw new Error(`Bu cihazda proje JSON dışa aktarımı için spritesheet toplam sınırı ${Math.floor(exportLimit / (1024 * 1024))} MiB. Daha az veya daha küçük görsel seçin.`);
    }

    const exported = [];
    for (const actor of this.actors) {
      if (!actor.sourceFile) throw new Error(`"${actor.name}" spritesheet kaynağı yok; taşınabilir proje kaydedilemedi.`);
      const bytes = new Uint8Array(await actor.sourceFile.arrayBuffer());
      let binary = '';
      for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
      exported.push({ id: actor.id, name: actor.name, columns: actor.columns, rows: actor.rows, fps: actor.fps, x: actor.x, y: actor.y, displayHeight: actor.displayHeight, mimeType: actor.sourceFile.type, fileName: actor.sourceFile.name, data: btoa(binary) });
    }
    return exported;
  }
  async exportAssetsForStorage() {
    return this.actors.map((actor) => {
      if (!actor.sourceFile) throw new Error(`"${actor.name}" spritesheet kaynağı yok; otomatik kayıt tamamlanamadı.`);
      return {
        id: actor.id, name: actor.name, columns: actor.columns, rows: actor.rows, fps: actor.fps,
        x: actor.x, y: actor.y, displayHeight: actor.displayHeight,
        mimeType: actor.sourceFile.type, fileName: actor.sourceFile.name,
        blob: actor.sourceFile.slice(0, actor.sourceFile.size, actor.sourceFile.type),
      };
    });
  }
  static validateProjectAssets(assets = []) {
    if (!Array.isArray(assets) || assets.length > 100) throw new Error('Projedeki spritesheet listesi geçersiz veya çok büyük.');
    const ids = new Set();
    let totalBytes = 0;
    for (const asset of assets) {
      if (!asset || typeof asset !== 'object' || typeof asset.id !== 'string' || !asset.id || asset.id.length > 128) {
        throw new Error('Projedeki spritesheet kimliği geçersiz.');
      }
      if (ids.has(asset.id)) throw new Error(`Projede yinelenen spritesheet kimliği var: ${asset.id}`);
      ids.add(asset.id);
      const hasBlob = typeof Blob !== 'undefined' && asset.blob instanceof Blob;
      if ((!hasBlob && typeof asset.data !== 'string') || (hasBlob && !asset.blob.size) || (typeof asset.data === 'string' && asset.data.length > 70 * 1024 * 1024)) {
        throw new Error('Spritesheet dosyası eksik veya güvenli boyut sınırını aşıyor.');
      }
      totalBytes += hasBlob ? asset.blob.size : Math.floor(asset.data.length * 3 / 4);
      if (totalBytes > MAX_FILE_SIZE * 2) throw new Error('Toplam proje boyutu 100 MB sınırını aşıyor.');
    }
    return ids;
  }

  async importAssets(assets = []) {
    const ids = SpriteAnimationManager.validateProjectAssets(assets);
    const stagingScene = new THREE.Scene();
    const staging = new SpriteAnimationManager(stagingScene, {
      width: this.width,
      height: this.height,
      onStateChange: () => {},
    });
    try {
      for (const asset of assets) {
        const bytes = asset.blob instanceof Blob
          ? new Uint8Array(await asset.blob.arrayBuffer())
          : Uint8Array.from(atob(asset.data), (char) => char.charCodeAt(0));
        const file = new File([bytes], asset.fileName || `${asset.name || 'sprite'}.png`, { type: asset.mimeType || 'image/png' });
        const actor = await staging.addSpriteSheet(file, { columns: asset.columns, rows: asset.rows, fps: asset.fps });
        actor.name = String(asset.name || actor.name).slice(0, 48);
        actor.id = asset.id;
        staging.nextId = Math.max(staging.nextId, Number(actor.id.match(/(\d+)$/)?.[1] || 0) + 1);
        staging.selectedId = actor.id;
        staging.setTransform(actor.id, { x: Number(asset.x), y: Number(asset.y), height: Number(asset.displayHeight) });
      }
    } catch (error) {
      for (const actor of staging.actors) {
        actor.texture.dispose();
        actor.sprite.material.dispose();
      }
      throw error;
    }

    for (const actor of this.actors) {
      this.stopAnimation(actor.id, false);
      this.scene.remove(actor.sprite);
      actor.texture.dispose();
      actor.sprite.material.dispose();
    }
    this.actors = staging.actors;
    this.selectedId = staging.selectedId;
    this.nextId = Math.max(1, staging.nextId);
    for (const actor of this.actors) {
      stagingScene.remove(actor.sprite);
      this.scene.add(actor.sprite);
    }
    this._notify('loaded');
    return ids;
  }
  getActor(id = this.selectedId) {
    return this.actors.find((actor) => actor.id === id) || null;
  }

  list() {
    return this.actors.map(({ id, name, columns, rows, frameCount, fps, x, y, displayHeight, isPlaying }) => ({
      id, name, columns, rows, frameCount, fps, x, y, displayHeight, isPlaying,
    }));
  }

  select(id) {
    if (!this.getActor(id)) return false;
    this.selectedId = id;
    this._notify('selected', this.getActor(id));
    return true;
  }

  setTransform(id, { x, y, height } = {}) {
    const actor = this.getActor(id);
    if (!actor) return false;
    if (Number.isFinite(Number(x))) actor.x = Number(x);
    if (Number.isFinite(Number(y))) actor.y = Number(y);
    if (Number.isFinite(Number(height))) actor.displayHeight = Math.max(16, Number(height));
    this._constrainActor(actor);
    this._setPosition(actor);
    this._notify('transformed', actor);
    return true;
  }

  _constrainActor(actor) {
    const aspect = actor.frameWidth / actor.frameHeight;
    const maxHeight = Math.max(1, Math.min(this.height, this.width / aspect));
    actor.displayHeight = Math.max(Math.min(16, maxHeight), Math.min(maxHeight, actor.displayHeight));
    const halfWidth = (actor.displayHeight * aspect) / 2;
    const halfHeight = actor.displayHeight / 2;
    actor.x = Math.max(halfWidth, Math.min(this.width - halfWidth, Number(actor.x) || halfWidth));
    actor.y = Math.max(halfHeight, Math.min(this.height - halfHeight, Number(actor.y) || halfHeight));
  }

  _setPosition(actor) {
    actor.sprite.position.set(actor.x, this.height - actor.y, 0);
    actor.sprite.scale.set(actor.displayHeight * (actor.frameWidth / actor.frameHeight), actor.displayHeight, 1);
  }

  _setFrame(actor, frame) {
    actor.frame = Math.max(0, Math.min(actor.frameCount - 1, Math.floor(frame)));
    const column = actor.frame % actor.columns;
    const row = Math.floor(actor.frame / actor.columns);
    actor.texture.offset.set(column / actor.columns, 1 - (row + 1) / actor.rows);
    actor.texture.needsUpdate = true;
  }

  playAnimation(id = this.selectedId, { duration = 2, fps = null, loop = true } = {}) {
    const actor = this.getActor(id);
    if (!actor) throw new Error('Zaman çizelgesindeki 2D spritesheet bulunamadı.');
    this.stopAnimation(id, false);
    actor.isPlaying = true;
    const requestedFps = fps === null || fps === undefined ? actor.fps : Number(fps);
    actor.fps = Number.isFinite(requestedFps) ? Math.max(1, Math.min(60, requestedFps)) : actor.fps;
    actor.loop = Boolean(loop);
    actor.playbackElapsed = 0;
    actor.frameProgress = 0;
    actor.duration = Number.isFinite(Number(duration)) && Number(duration) > 0 ? Number(duration) : null;
    this._notify('playing', actor);
    return new Promise((resolve) => { actor.resolver = resolve; });
  }

  stopAnimation(id = this.selectedId, result = false) {
    const actor = this.getActor(id);
    if (!actor) return false;
    actor.isPlaying = false;
    actor.duration = null;
    if (actor.resolver) {
      const resolve = actor.resolver;
      actor.resolver = null;
      resolve(result);
    }
    this._notify('stopped', actor);
    return true;
  }

  remove(id = this.selectedId) {
    const index = this.actors.findIndex((actor) => actor.id === id);
    if (index < 0) return false;
    const actor = this.actors[index];
    this.stopAnimation(id);
    this.actors.splice(index, 1);
    this.scene.remove(actor.sprite);
    actor.texture.dispose();
    actor.sprite.material.dispose();
    this.selectedId = this.actors[Math.max(0, index - 1)]?.id || null;
    this._notify('removed', actor);
    return true;
  }

  update(delta) {
    if (this.isPaused) return;
    for (const actor of this.actors) {
      if (!actor.isPlaying) continue;
      actor.playbackElapsed += delta;
      actor.frameProgress += delta * actor.fps;
      const advances = Math.floor(actor.frameProgress);
      if (advances > 0) {
        actor.frameProgress -= advances;
        const nextFrame = actor.frame + advances;
        if (nextFrame >= actor.frameCount && !actor.loop) {
          this._setFrame(actor, actor.frameCount - 1);
          this.stopAnimation(actor.id, true);
          continue;
        }
        this._setFrame(actor, actor.loop ? nextFrame % actor.frameCount : nextFrame);
      }
      if (actor.duration !== null && actor.playbackElapsed >= actor.duration) {
        this.stopAnimation(actor.id, true);
      }
    }
  }

  pauseAll(paused) {
    this.isPaused = Boolean(paused);
  }

  stopAll() {
    for (const actor of this.actors) this.stopAnimation(actor.id, false);
  }

  resize(width, height) {
    const previousWidth = this.width;
    const previousHeight = this.height;
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    for (const actor of this.actors) {
      actor.x = (actor.x / previousWidth) * this.width;
      actor.y = (actor.y / previousHeight) * this.height;
      actor.displayHeight = (actor.displayHeight / previousHeight) * this.height;
      this._constrainActor(actor);
      this._setPosition(actor);
    }
    this._notify('resized');
  }

  _notify(type, actor) {
    this.onStateChange({ type, actor: actor ? { id: actor.id, name: actor.name } : null, actors: this.list(), selectedId: this.selectedId });
  }
}
