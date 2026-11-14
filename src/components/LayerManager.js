import * as THREE from 'three';
import { getDeviceMemoryGiB, getDevicePerformanceProfile, validateTextureDimensions } from '../utils/device-profile.js';

const MAX_FILE_SIZE = 50 * 1024 * 1024;
const MAX_LAYERS = 100;
const DEFAULT_LAYER_ID = 'layer-0';
const SUPPORTED_TYPES = new Set(['image/png', 'image/webp', 'image/jpeg']);

function assetSize(asset) {
  return asset?.sourceFile?.size || asset?.blob?.size || (typeof asset?.data === 'string' ? Math.floor(asset.data.length * 3 / 4) : 0);
}

/** Screen-space 2D image layers. Every visual starts in the default layer-0 slot. */
export class LayerManager {
  static DEFAULT_LAYER_ID = DEFAULT_LAYER_ID;
  static MAX_LAYERS = MAX_LAYERS;

  constructor(scene, { width = window.innerWidth, height = window.innerHeight, onStateChange = () => {} } = {}) {
    this.scene = scene;
    this.width = Math.max(1, Number(width) || 1);
    this.height = Math.max(1, Number(height) || 1);
    this.onStateChange = onStateChange;
    this.layers = [];
    this.selectedId = null;
    this.nextId = 0;
    this.maxAssetBytes = getDevicePerformanceProfile(getDeviceMemoryGiB()).maxProjectAssetExportBytes;
  }

  resize(width, height) {
    this.width = Math.max(1, Number(width) || 1);
    this.height = Math.max(1, Number(height) || 1);
    for (const layer of this.layers) this._updateSprite(layer);
  }

  getDefaultLayerId() { return DEFAULT_LAYER_ID; }

  async addLayer(file, { name = '', id = '', x, y, width, height, visible = true, opacity = 1, order } = {}) {
    if (!file || !SUPPORTED_TYPES.has(file.type || '')) throw new Error('PNG, WebP veya JPEG görsel seçin.');
    if (!Number.isFinite(file.size) || file.size <= 0 || file.size > MAX_FILE_SIZE) throw new Error('Katman görseli boş olamaz ve en fazla 50 MB olabilir.');
    if (this.layers.length >= MAX_LAYERS) throw new Error(`En fazla ${MAX_LAYERS} katman eklenebilir.`);
    const totalBytes = this.layers.reduce((sum, layer) => sum + assetSize(layer), 0) + file.size;
    if (totalBytes > this.maxAssetBytes) throw new Error(`Katman görselleri toplamı bu cihazda ${Math.floor(this.maxAssetBytes / (1024 * 1024))} MiB sınırını aşamaz.`);
    if (id && (typeof id !== 'string' || id.length > 128 || this.layers.some((layer) => layer.id === id))) throw new Error('Katman kimliği geçersiz veya yineleniyor.');

    const objectUrl = URL.createObjectURL(file);
    let texture;
    try {
      texture = await this._loadTexture(objectUrl);
    } catch (error) {
      URL.revokeObjectURL(objectUrl);
      throw new Error(`Görsel okunamadı: ${error.message || 'format hatalı'}`);
    }
    URL.revokeObjectURL(objectUrl);

    const imageWidth = texture.image?.naturalWidth || texture.image?.width || 0;
    const imageHeight = texture.image?.naturalHeight || texture.image?.height || 0;
    try { validateTextureDimensions(imageWidth, imageHeight); }
    catch (error) { texture.dispose(); throw error; }

    const safeOpacity = Number(opacity);
    if (!Number.isFinite(safeOpacity) || safeOpacity < 0 || safeOpacity > 1) {
      texture.dispose();
      throw new Error('Katman opaklığı 0 ile 1 arasında olmalı.');
    }
    const layerId = id || this._nextLayerId();
    const defaultWidth = Math.min(this.width * 0.8, imageWidth);
    const defaultHeight = Math.min(this.height * 0.8, imageHeight);
    const layer = {
      id: layerId,
      name: String(name || file.name || 'Katman').replace(/\.(png|webp|jpe?g)$/i, '').slice(0, 48) || 'Katman',
      sprite: null,
      texture,
      visible: Boolean(visible),
      opacity: safeOpacity,
      x: Number.isFinite(Number(x)) ? Number(x) : this.width * 0.5,
      y: Number.isFinite(Number(y)) ? Number(y) : this.height * 0.5,
      width: Number.isFinite(Number(width)) ? Math.max(1, Number(width)) : defaultWidth,
      height: Number.isFinite(Number(height)) ? Math.max(1, Number(height)) : defaultHeight,
      order: Number.isInteger(order) ? Math.max(0, order) : this.layers.length,
      sourceFile: file,
    };

    texture.colorSpace = THREE.SRGBColorSpace;
    texture.magFilter = THREE.LinearFilter;
    texture.minFilter = THREE.LinearFilter;
    texture.generateMipmaps = true;
    texture.needsUpdate = true;
    layer.sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false, depthWrite: false, toneMapped: false }));
    this._updateSprite(layer);
    this.scene.add(layer.sprite);
    this.layers.push(layer);
    this.layers.sort((a, b) => a.order - b.order);
    this._reassignOrders();
    this.selectedId = layer.id;
    this._notify('added', layer);
    return layer.id;
  }

  async importAssets(assets = []) {
    LayerManager.validateProjectAssets(assets);
    const stagingScene = new THREE.Scene();
    const staging = new LayerManager(stagingScene, { width: this.width, height: this.height, onStateChange: () => {} });
    try {
      for (const asset of assets) {
        const bytes = asset.blob instanceof Blob
          ? new Uint8Array(await asset.blob.arrayBuffer())
          : Uint8Array.from(atob(asset.data), (char) => char.charCodeAt(0));
        const file = new File([bytes], asset.fileName || `${asset.name || 'layer'}.png`, { type: asset.mimeType || 'image/png' });
        await staging.addLayer(file, asset);
      }
    } catch (error) {
      staging.dispose();
      throw error;
    }
    this.dispose();
    this.layers = staging.layers;
    this.selectedId = staging.selectedId;
    this.nextId = staging.nextId;
    for (const layer of this.layers) {
      stagingScene.remove(layer.sprite);
      this.scene.add(layer.sprite);
    }
    this._notify('loaded');
    return this.list();
  }

  async exportAssetsForStorage() {
    return this.layers.map((layer) => ({
      id: layer.id,
      name: layer.name,
      mimeType: layer.sourceFile?.type || 'image/png',
      fileName: layer.sourceFile?.name || `${layer.name || 'layer'}.png`,
      blob: layer.sourceFile?.slice(0, layer.sourceFile.size, layer.sourceFile.type || 'image/png'),
      x: layer.x, y: layer.y, width: layer.width, height: layer.height,
      visible: layer.visible, opacity: layer.opacity, order: layer.order,
    }));
  }

  static validateProjectAssets(assets = []) {
    if (!Array.isArray(assets) || assets.length > MAX_LAYERS) throw new Error(`Katman listesi geçersiz veya ${MAX_LAYERS} sınırını aşıyor.`);
    const ids = new Set();
    let totalBytes = 0;
    for (const asset of assets) {
      if (!asset || typeof asset.id !== 'string' || !asset.id || asset.id.length > 128 || ids.has(asset.id)) throw new Error('Katman kimliği geçersiz veya yineleniyor.');
      ids.add(asset.id);
      const size = assetSize(asset);
      if (!size || size > MAX_FILE_SIZE) throw new Error(`'${asset.id}' katman görseli eksik veya çok büyük.`);
      totalBytes += size;
      const values = [asset.x, asset.y, asset.width, asset.height, asset.opacity];
      if (values.some((value) => !Number.isFinite(Number(value))) || Number(asset.width) < 1 || Number(asset.height) < 1 || Number(asset.opacity) < 0 || Number(asset.opacity) > 1) throw new Error(`'${asset.id}' katman geometrisi veya opaklığı geçersiz.`);
      if (asset.visible !== undefined && typeof asset.visible !== 'boolean') throw new Error(`'${asset.id}' katman görünürlüğü geçersiz.`);
    }
    const limit = getDevicePerformanceProfile(getDeviceMemoryGiB()).maxProjectAssetExportBytes;
    if (totalBytes > limit) throw new Error(`Katman görselleri toplamı bu cihazda ${Math.floor(limit / (1024 * 1024))} MiB sınırını aşamaz.`);
    return ids;
  }

  removeLayer(id) {
    const index = this.layers.findIndex((layer) => layer.id === id);
    if (index < 0) return false;
    const layer = this.layers[index];
    this.scene.remove(layer.sprite);
    layer.texture.dispose();
    layer.sprite.material.dispose();
    this.layers.splice(index, 1);
    this._reassignOrders();
    if (this.selectedId === id) this.selectedId = this.layers.at(-1)?.id || null;
    this._notify('removed', { id });
    return true;
  }

  select(id) {
    if (id && !this.layers.some((layer) => layer.id === id)) return false;
    this.selectedId = id || null;
    this._notify('selected');
    return true;
  }

  setVisible(id, visible) {
    const layer = this._get(id);
    if (!layer) return false;
    layer.visible = Boolean(visible);
    layer.sprite.visible = layer.visible;
    this._notify('visibility', layer);
    return true;
  }

  setOpacity(id, opacity) {
    const layer = this._get(id);
    const value = Number(opacity);
    if (!layer || !Number.isFinite(value)) return false;
    layer.opacity = Math.max(0, Math.min(1, value));
    layer.sprite.material.opacity = layer.opacity;
    layer.sprite.material.transparent = layer.opacity < 1;
    layer.sprite.material.needsUpdate = true;
    this._notify('opacity', layer);
    return true;
  }

  setPosition(id, x, y) {
    const layer = this._get(id);
    if (!layer || !Number.isFinite(Number(x)) || !Number.isFinite(Number(y))) return false;
    layer.x = Number(x); layer.y = Number(y); this._updateSprite(layer); this._notify('position', layer); return true;
  }

  setSize(id, width, height) {
    const layer = this._get(id);
    if (!layer || !Number.isFinite(Number(width)) || !Number.isFinite(Number(height))) return false;
    layer.width = Math.max(1, Number(width)); layer.height = Math.max(1, Number(height)); this._updateSprite(layer); this._notify('size', layer); return true;
  }

  setOrder(orderedIds) {
    if (!Array.isArray(orderedIds)) return false;
    const known = new Map(this.layers.map((layer) => [layer.id, layer]));
    const reordered = [];
    for (const id of orderedIds) { if (known.has(id)) reordered.push(known.get(id)); known.delete(id); }
    for (const layer of this.layers) if (known.has(layer.id)) reordered.push(layer);
    this.layers = reordered; this._reassignOrders(); this._notify('reordered'); return true;
  }

  moveLayer(id, direction) {
    const index = this.layers.findIndex((layer) => layer.id === id);
    if (index < 0) return false;
    const target = index + (direction === 'up' ? 1 : -1);
    if (target < 0 || target >= this.layers.length) return false;
    const [item] = this.layers.splice(index, 1); this.layers.splice(target, 0, item); this._reassignOrders(); this._notify('reordered'); return true;
  }

  list() { return this.layers.map((layer) => ({ id: layer.id, name: layer.name, visible: layer.visible, opacity: layer.opacity, x: layer.x, y: layer.y, width: layer.width, height: layer.height, order: layer.order })); }

  async applyTimelineStep(step) {
    if (!step?.type) return;
    const id = step.layerId || step.actorId;
    switch (step.type) {
      case 'SET_LAYER_VISIBILITY': this.setVisible(id, step.data?.visible !== false); break;
      case 'SET_LAYER_OPACITY': this.setOpacity(id, step.data?.opacity ?? 1); break;
      case 'SET_LAYER_ORDER':
        if (Array.isArray(step.data?.order)) this.setOrder(step.data.order);
        else if (step.data?.direction === 'up' || step.data?.direction === 'down') this.moveLayer(id, step.data.direction);
        break;
      default: break;
    }
  }

  _nextLayerId() { while (this.layers.some((layer) => layer.id === `layer-${this.nextId}`)) this.nextId += 1; return `layer-${this.nextId++}`; }
  _get(id) { return this.layers.find((layer) => layer.id === id) || null; }
  _updateSprite(layer) { layer.sprite.position.set(layer.x, layer.y, 0); layer.sprite.scale.set(layer.width, layer.height, 1); layer.sprite.visible = layer.visible; layer.sprite.material.opacity = layer.opacity; layer.sprite.renderOrder = 400 + layer.order; }
  _reassignOrders() { this.layers.forEach((layer, index) => { layer.order = index; layer.sprite.renderOrder = 400 + index; }); }
  _loadTexture(url) { return new Promise((resolve, reject) => new THREE.TextureLoader().load(url, resolve, undefined, reject)); }
  _notify(type, layer = null) { this.onStateChange({ type, layers: this.list(), selectedId: this.selectedId, layer: layer ? { id: layer.id, name: layer.name, visible: layer.visible, opacity: layer.opacity } : null }); }
  dispose() { for (const layer of this.layers) { this.scene.remove(layer.sprite); layer.texture.dispose(); layer.sprite.material.dispose(); } this.layers = []; this.selectedId = null; this.nextId = 0; }
}
