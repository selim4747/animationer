import * as THREE from 'three';

const finite = (value, fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const objectTransform = (object) => ({
  position: { x: object.position.x, y: object.position.y, z: object.position.z },
  rotation: { x: object.rotation.x, y: object.rotation.y, z: object.rotation.z },
  scale: { x: object.scale.x, y: object.scale.y, z: object.scale.z },
});

/** Scene object picker and safe numeric transform editor for demo and imported content. */
export class SceneEditor {
  constructor({ scene, camera, domElement, mapLoader, sceneBuilder, door, collisionManager, characters, worldSprites, onChange = () => {} }) {
    this.scene = scene;
    this.camera = camera;
    this.domElement = domElement;
    this.mapLoader = mapLoader;
    this.sceneBuilder = sceneBuilder;
    this.door = door;
    this.collisionManager = collisionManager;
    this.characters = characters;
    this.worldSprites = worldSprites;
    this.onChange = onChange;
    this.active = false;
    this.mode = 'translate';
    this.selectedId = null;
    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
  }

  setActive(active) {
    this.active = Boolean(active);
    if (!this.active) this.select(null);
    else this.onChange({ type: 'active', active: true, objects: this.list() });
    return this.active;
  }

  setMode(mode) {
    if (!['translate', 'rotate', 'scale'].includes(mode)) return false;
    this.mode = mode;
    this.onChange({ type: 'mode', mode, selection: this.getSelection() });
    return true;
  }

  _entries() {
    const entries = [];
    const push = (id, object, label, kind = 'scene', raycastRoot = object) => {
      if (!id || !object?.isObject3D || object.visible === false) return;
      if (!object.userData.sceneEditorDefaultTransform) object.userData.sceneEditorDefaultTransform = objectTransform(object);
      entries.push({ id, object, raycastRoot, label, kind });
    };

    this.scene?.traverse?.((object) => {
      const id = object.userData?.sceneEditorId;
      if (id) push(id, object, object.userData.sceneEditorLabel || object.name || id, 'scene');
    });
    for (const [meshId, object] of this.mapLoader?.meshesByEditorId || []) {
      push(`map:${meshId}`, object, object.name || `Harita nesnesi ${meshId}`, 'map');
    }
    for (const [index, object] of (this.collisionManager?.wallBoxes || []).entries()) {
      const id = object.userData?.sceneEditorId || `wall:${index}`;
      object.userData.sceneEditorId = id;
      push(id, object, `Engel kutusu ${index + 1}`, 'wall');
    }
    const seen = new Set();
    return entries.filter((entry) => {
      if (seen.has(entry.id)) return false;
      seen.add(entry.id);
      return true;
    });
  }

  list() { return this._entries().map(({ id, label, kind }) => ({ id, label, kind })); }

  getSelection() {
    const entry = this._entries().find((item) => item.id === this.selectedId);
    return entry ? { id: entry.id, label: entry.label, kind: entry.kind, transform: objectTransform(entry.object), mode: this.mode } : null;
  }

  select(id) {
    const entry = this._entries().find((item) => item.id === id) || null;
    this.selectedId = entry?.id || null;
    this.onChange({ type: 'selection', active: this.active, objects: this.list(), selection: this.getSelection() });
    return this.getSelection();
  }

  selectAt(clientX, clientY) {
    if (!this.active || !this.domElement || !this.camera) return false;
    const rect = this.domElement.getBoundingClientRect();
    if (!rect.width || !rect.height) return false;
    this.pointer.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const entries = this._entries();
    const roots = entries.map((entry) => entry.raycastRoot);
    const hit = this.raycaster.intersectObjects(roots, true)[0];
    if (!hit) {
      this.select(null);
      return true;
    }
    let match = entries.find((entry) => entry.object === hit.object || entry.object === hit.object.parent);
    if (!match) {
      match = entries.find((entry) => entry.object === hit.object || entry.object.getObjectById?.(hit.object.id));
    }
    this.select(match?.id || null);
    return true;
  }

  setTransform(id, transform = {}) {
    const entry = this._entries().find((item) => item.id === (id || this.selectedId));
    if (!entry) return false;
    const { object, kind } = entry;
    const applyVector = (target, values, { scale = false } = {}) => {
      if (!values) return;
      for (const axis of ['x', 'y', 'z']) {
        const next = finite(values[axis], target[axis]);
        target[axis] = scale ? THREE.MathUtils.clamp(next, 0.01, 1000) : THREE.MathUtils.clamp(next, -10000, 10000);
      }
    };
    applyVector(object.position, transform.position);
    applyVector(object.rotation, transform.rotation);
    applyVector(object.scale, transform.scale, { scale: true });
    object.updateMatrixWorld(true);

    if (kind === 'map') {
      this.mapLoader?.syncEditedMesh?.(object);
    } else if (kind === 'wall') {
      const base = object.geometry?.parameters || {};
      object.userData.width = Number(base.width || object.userData.width || 2) * object.scale.x;
      object.userData.height = Number(base.height || object.userData.height || 2) * object.scale.y;
      object.userData.depth = Number(base.depth || object.userData.depth || 2) * object.scale.z;
      object.position.y = object.userData.height / 2;
      object.rotation.set(0, 0, 0);
      this.collisionManager?.updateObstacleBoxes?.();
      this.mapLoader?.onStateChange?.({ type: 'wall-box-edited' });
    }
    this.collisionManager?.updateObstacleBoxes?.();
    this.onChange({ type: 'transform', active: this.active, objects: this.list(), selection: this.getSelection() });
    return true;
  }

  resetTransform(id = this.selectedId) {
    const entry = this._entries().find((item) => item.id === id);
    const original = entry?.object.userData.sceneEditorDefaultTransform;
    if (!entry || !original) return false;
    return this.setTransform(id, original);
  }

  exportProjectState() {
    return this._entries().filter(({ kind }) => kind === 'scene').map(({ id, object }) => ({ id, ...objectTransform(object) }));
  }

  restoreProjectState(edits = []) {
    if (!Array.isArray(edits)) throw new Error('Sahne düzenleme verisi geçersiz.');
    const available = new Map(this._entries().filter(({ kind }) => kind === 'scene').map((entry) => [entry.id, entry.object]));
    for (const edit of edits) {
      const object = available.get(edit?.id);
      if (!object) continue;
      const vectors = [edit.position, edit.rotation, edit.scale];
      if (vectors.some((vector) => !vector || !['x', 'y', 'z'].every((axis) => Number.isFinite(Number(vector[axis]))))) {
        throw new Error(`“${edit?.id || 'nesne'}” sahne dönüşümü geçersiz.`);
      }
      object.position.set(edit.position.x, edit.position.y, edit.position.z);
      object.rotation.set(edit.rotation.x, edit.rotation.y, edit.rotation.z);
      object.scale.set(edit.scale.x, edit.scale.y, edit.scale.z);
      object.updateMatrixWorld(true);
    }
    this.collisionManager?.updateObstacleBoxes?.();
    this.onChange({ type: 'restored', objects: this.list(), selection: this.getSelection() });
    return this.exportProjectState();
  }
}
