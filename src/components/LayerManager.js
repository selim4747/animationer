import * as THREE from 'three';
import { validateTextureDimensions } from '../utils/device-profile.js';

const MAX_FILE_SIZE = 50 * 1024 * 1024;
const SUPPORTED_TYPES = new Set(['image/png', 'image/webp', 'image/jpeg']);

/**
 * Screen-space 2D layers for a pure 2D scene overlay.
 * Layers can be reordered, shown/hidden, and have opacity/position adjusted
 * at any time, including during timeline playback.
 */
export class LayerManager {
  constructor(scene, { width = window.innerWidth, height = window.innerHeight, onStateChange = () => {} } = {}) {
    this.scene = scene;
    this.width = width;
    this.height = height;
    this.onStateChange = onStateChange;
    this.layers = [];
    this.selectedId = null;
    this.nextId = 1;
  }

  resize(width, height) {
    this.width = width;
    this.height = height;
    for (const layer of this.layers) this._updateSprite(layer);
  }

  async addLayer(file, { name = '' } = {}) {
    if (!file || !SUPPORTED_TYPES.has(file.type || '')) {
      throw new Error('PNG, WebP veya JPEG görsel seçin.');
    }
    if (file.size > MAX_FILE_SIZE) throw new Error('Katman görseli en fazla 50 MB olabilir.');

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
    try {
      validateTextureDimensions(imageWidth, imageHeight);
    } catch (error) {
      texture.dispose();
      throw error;
    }

    texture.colorSpace = THREE.SRGBColorSpace;
    texture.magFilter = THREE.LinearFilter;
    texture.minFilter = THREE.LinearFilter;
    texture.generateMipmaps = true;
    texture.needsUpdate = true;

    const material = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });
    const sprite = new THREE.Sprite(material);
    sprite.renderOrder = 500 + this.layers.length; // below most sprites by default, or configurable

    const layer = {
      id: `layer-${this.nextId++}`,
      name: (name || file.name || 'Katman').replace(/\.(png|webp|jpe?g)$/i, '').slice(0, 48),
      sprite,
      texture,
      visible: true,
      opacity: 1,
      x: this.width * 0.5,
      y: this.height * 0.5,
      width: Math.min(this.width * 0.8, imageWidth),
      height: Math.min(this.height * 0.8, imageHeight),
      order: this.layers.length,
      sourceFile: file,
    };

    this._updateSprite(layer);
    this.scene.add(sprite);
    this.layers.push(layer);
    this.selectedId = layer.id;
    this._notify('added', layer);
    return layer.id;
  }

  removeLayer(id) {
    const index = this.layers.findIndex((l) => l.id === id);
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
    if (id && !this.layers.some((l) => l.id === id)) return false;
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
    if (!layer) return false;
    const value = Math.max(0, Math.min(1, Number(opacity)));
    layer.opacity = value;
    layer.sprite.material.opacity = value;
    layer.sprite.material.transparent = value < 1;
    this._notify('opacity', layer);
    return true;
  }

  setPosition(id, x, y) {
    const layer = this._get(id);
    if (!layer) return false;
    layer.x = Number(x);
    layer.y = Number(y);
    this._updateSprite(layer);
    this._notify('position', layer);
    return true;
  }

  setSize(id, width, height) {
    const layer = this._get(id);
    if (!layer) return false;
    layer.width = Math.max(1, Number(width));
    layer.height = Math.max(1, Number(height));
    this._updateSprite(layer);
    this._notify('size', layer);
    return true;
  }

  /**
   * Reorder layers. `orderedIds` is the new bottom-to-top order.
   * Layers not listed keep their relative order at the end.
   */
  setOrder(orderedIds) {
    if (!Array.isArray(orderedIds)) return false;
    const known = new Map(this.layers.map((l) => [l.id, l]));
    const reordered = [];
    for (const id of orderedIds) {
      if (known.has(id)) reordered.push(known.get(id));
      known.delete(id);
    }
    for (const layer of this.layers) {
      if (known.has(layer.id)) reordered.push(layer);
    }
    this.layers = reordered;
    this._reassignOrders();
    this._notify('reordered');
    return true;
  }

  moveLayer(id, direction) {
    const index = this.layers.findIndex((l) => l.id === id);
    if (index < 0) return false;
    const target = index + (direction === 'up' ? 1 : -1);
    if (target < 0 || target >= this.layers.length) return false;
    const [item] = this.layers.splice(index, 1);
    this.layers.splice(target, 0, item);
    this._reassignOrders();
    this._notify('reordered');
    return true;
  }

  list() {
    return this.layers.map((l) => ({
      id: l.id,
      name: l.name,
      visible: l.visible,
      opacity: l.opacity,
      x: l.x,
      y: l.y,
      width: l.width,
      height: l.height,
      order: l.order,
    }));
  }

  /**
   * Apply a timeline step that targets a layer.
   * Supported: SET_LAYER_VISIBILITY, SET_LAYER_OPACITY, SET_LAYER_ORDER
   */
  async applyTimelineStep(step) {
    if (!step?.type) return;
    const id = step.layerId || step.actorId;
    switch (step.type) {
      case 'SET_LAYER_VISIBILITY':
        this.setVisible(id, step.data?.visible !== false);
        break;
      case 'SET_LAYER_OPACITY':
        this.setOpacity(id, step.data?.opacity ?? 1);
        break;
      case 'SET_LAYER_ORDER':
        if (Array.isArray(step.data?.order)) this.setOrder(step.data.order);
        else if (step.data?.direction) this.moveLayer(id, step.data.direction);
        break;
      default:
        break;
    }
  }

  _get(id) {
    return this.layers.find((l) => l.id === id) || null;
  }

  _updateSprite(layer) {
    layer.sprite.position.set(layer.x, layer.y, 0);
    layer.sprite.scale.set(layer.width, layer.height, 1);
    layer.sprite.visible = layer.visible;
    layer.sprite.material.opacity = layer.opacity;
    layer.sprite.renderOrder = 400 + layer.order; // keep below character sprites (1000+)
  }

  _reassignOrders() {
    this.layers.forEach((layer, index) => {
      layer.order = index;
      layer.sprite.renderOrder = 400 + index;
    });
  }

  _loadTexture(url) {
    return new Promise((resolve, reject) => {
      const loader = new THREE.TextureLoader();
      loader.load(url, resolve, undefined, reject);
    });
  }

  _notify(type, layer = null) {
    this.onStateChange({
      type,
      layers: this.list(),
      selectedId: this.selectedId,
      layer: layer ? { id: layer.id, name: layer.name, visible: layer.visible, opacity: layer.opacity } : null,
    });
  }

  dispose() {
    for (const layer of this.layers) {
      this.scene.remove(layer.sprite);
      layer.texture.dispose();
      layer.sprite.material.dispose();
    }
    this.layers = [];
    this.selectedId = null;
  }
}
