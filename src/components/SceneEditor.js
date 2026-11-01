import * as THREE from 'three';

const COLOR_PATTERN = /^#?[0-9a-f]{6}$/i;
const PRIMITIVE_TYPES = new Set(['box', 'sphere', 'cylinder', 'cone']);
const finite = (value, fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const objectTransform = (object) => ({
  position: { x: object.position.x, y: object.position.y, z: object.position.z },
  rotation: { x: object.rotation.x, y: object.rotation.y, z: object.rotation.z },
  scale: { x: object.scale.x, y: object.scale.y, z: object.scale.z },
});
const normalizeColor = (value) => COLOR_PATTERN.test(String(value || ''))
  ? `#${String(value).replace(/^#/, '').toLowerCase()}`
  : null;

/** Scene object picker and safe numeric transform/color editor for demo and imported content. */
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
    this.undoStack = [];
    this.redoStack = [];
    this.historyLimit = 100;
    this._originalMaterials = new WeakMap();
    this._colorOwnedObjects = new Set();
    this._primitiveCounter = 0;
  }

  get canUndo() { return this.undoStack.length > 0; }
  get canRedo() { return this.redoStack.length > 0; }

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
      if (id) push(id, object, object.userData.sceneEditorLabel || object.name || id, object.userData.sceneEditorKind === 'primitive' ? 'primitive' : 'scene');
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

  getObjectColor(object) {
    const materials = Array.isArray(object?.material) ? object.material : [object?.material];
    if (!materials.length || materials.some((material) => !material?.color?.getHexString)) return null;
    return `#${materials[0].color.getHexString()}`;
  }

  getSelectedColor() {
    const entry = this._entries().find((item) => item.id === this.selectedId);
    return entry ? this.getObjectColor(entry.object) : null;
  }

  getSelection() {
    const entry = this._entries().find((item) => item.id === this.selectedId);
    return entry ? {
      id: entry.id,
      label: entry.label,
      kind: entry.kind,
      transform: objectTransform(entry.object),
      color: this.getObjectColor(entry.object),
      mode: this.mode,
    } : null;
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
    const hit = this.raycaster.intersectObjects(entries.map((entry) => entry.raycastRoot), true)[0];
    if (!hit) {
      this.select(null);
      return true;
    }
    let match = entries.find((entry) => entry.object === hit.object || entry.object === hit.object.parent);
    if (!match) match = entries.find((entry) => entry.object === hit.object || entry.object.getObjectById?.(hit.object.id));
    this.select(match?.id || null);
    return true;
  }

  _applyTransform(entry, transform) {
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
      this.mapLoader?.onStateChange?.({ type: 'wall-box-edited' });
    }
    this.collisionManager?.updateObstacleBoxes?.();
  }

  setTransform(id, transform = {}) {
    const entry = this._entries().find((item) => item.id === (id || this.selectedId));
    if (!entry) return false;
    const before = objectTransform(entry.object);
    this._applyTransform(entry, transform);
    const after = objectTransform(entry.object);
    this._pushHistory({ id: entry.id, transform: before }, { id: entry.id, transform: after });
    this.onChange({ type: 'transform', active: this.active, objects: this.list(), selection: this.getSelection() });
    return true;
  }

  _pushHistory(before, after) {
    if (JSON.stringify(before) === JSON.stringify(after)) return;
    this.undoStack.push(before);
    if (this.undoStack.length > this.historyLimit) this.undoStack.shift();
    this.redoStack.length = 0;
  }

  undo() { return this._replayHistory(this.undoStack, this.redoStack); }
  redo() { return this._replayHistory(this.redoStack, this.undoStack); }

  _replayHistory(source, destination) {
    const snapshot = source.pop();
    if (!snapshot) return false;
    const entry = this._entries().find((item) => item.id === snapshot.id);
    if (!entry) { source.push(snapshot); return false; }
    destination.push({ id: snapshot.id, transform: objectTransform(entry.object) });
    if (destination.length > this.historyLimit) destination.shift();
    this._applyTransform(entry, snapshot.transform);
    this.onChange({ type: 'transform', active: this.active, objects: this.list(), selection: this.getSelection() });
    return true;
  }

  resetTransform(id = this.selectedId) {
    const entry = this._entries().find((item) => item.id === id);
    const original = entry?.object.userData.sceneEditorDefaultTransform;
    if (!entry || !original) return false;
    return this.setTransform(id, original);
  }

  setColor(id, color) {
    const entry = this._entries().find((item) => item.id === (id || this.selectedId));
    const normalized = normalizeColor(color);
    if (!entry || !normalized) return false;
    const object = entry.object;
    const current = Array.isArray(object.material) ? object.material : [object.material];
    if (!current.length || current.some((material) => !material?.color?.set)) return false;

    if (!this._originalMaterials.has(object)) {
      const original = object.material;
      const cloned = current.map((material) => material.clone());
      this._originalMaterials.set(object, original);
      this._colorOwnedObjects.add(object);
      object.material = Array.isArray(original) ? cloned : cloned[0];
    }
    const owned = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of owned) material.color.set(normalized);
    if (object.userData.sceneEditorKind === 'primitive') object.userData.primitiveDescriptor.color = normalized;
    this.onChange({ type: 'color', active: this.active, objects: this.list(), selection: this.getSelection(), color: normalized });
    return true;
  }

  applySelectedColor(color) { return this.setColor(this.selectedId, color); }

  _restoreOriginalMaterial(object) {
    if (!this._originalMaterials.has(object)) return;
    const current = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of current) material?.dispose?.();
    object.material = this._originalMaterials.get(object);
    this._originalMaterials.delete(object);
    this._colorOwnedObjects.delete(object);
  }

  createPrimitive(type, options = {}) {
    if (!PRIMITIVE_TYPES.has(type)) throw new Error('Desteklenmeyen nesne türü.');
    const dimension = (key, fallback = 1) => {
      const value = Number(options[key] ?? fallback);
      if (!Number.isFinite(value) || value <= 0 || value > 1000) throw new Error('Nesne ölçüleri 0 ile 1000 arasında olmalı.');
      return value;
    };
    const width = dimension('width');
    const height = dimension('height');
    const depth = dimension('depth');
    const radius = dimension('radius');
    const color = normalizeColor(options.color || '#b8b8b8');
    if (!color) throw new Error('Nesne rengi geçersiz.');
    const id = String(options.id || `primitive:${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${++this._primitiveCounter}`}`);
    if (!id || id.length > 256 || this._entries().some((entry) => entry.id === id)) throw new Error('Nesne kimliği geçersiz veya yineleniyor.');
    const geometry = type === 'box'
      ? new THREE.BoxGeometry(width, height, depth)
      : type === 'sphere'
        ? new THREE.SphereGeometry(radius, 24, 16)
        : type === 'cylinder'
          ? new THREE.CylinderGeometry(radius, radius, height, 24)
          : new THREE.ConeGeometry(radius, height, 24);
    const material = new THREE.MeshStandardMaterial({ color });
    const object = new THREE.Mesh(geometry, material);
    object.userData.sceneEditorId = id;
    object.userData.sceneEditorKind = 'primitive';
    object.userData.sceneEditorLabel = String(options.name || type).trim().slice(0, 80) || type;
    object.userData.primitiveDescriptor = { type, width, height, depth, radius, color, name: object.userData.sceneEditorLabel };
    const position = options.position || { x: 0, y: 0.5, z: 0 };
    for (const axis of ['x', 'y', 'z']) {
      const value = Number(position[axis] ?? (axis === 'y' ? 0.5 : 0));
      if (!Number.isFinite(value) || Math.abs(value) > 10000) {
        geometry.dispose();
        material.dispose();
        throw new Error('Nesne konumu ±10000 aralığında geçerli sayılar olmalı.');
      }
      object.position[axis] = value;
    }
    object.castShadow = true;
    object.receiveShadow = true;
    this.scene?.add(object);
    this.onChange({ type: 'primitive-added', active: this.active, objects: this.list(), selection: this.getSelection() });
    return object;
  }

  removePrimitive(id = this.selectedId) {
    const entry = this._entries().find((item) => item.id === id);
    if (!entry || entry.object.userData.sceneEditorKind !== 'primitive') return false;
    entry.object.parent?.remove(entry.object);
    entry.object.geometry?.dispose?.();
    const materials = Array.isArray(entry.object.material) ? entry.object.material : [entry.object.material];
    materials.forEach((material) => material?.dispose?.());
    this._originalMaterials.delete(entry.object);
    this._colorOwnedObjects.delete(entry.object);
    this.undoStack = this.undoStack.filter((item) => item.id !== id);
    this.redoStack = this.redoStack.filter((item) => item.id !== id);
    if (this.selectedId === id) this.selectedId = null;
    this.onChange({ type: 'primitive-removed', active: this.active, objects: this.list(), selection: this.getSelection() });
    return true;
  }

  dispose() {
    for (const entry of this._entries()) {
      if (entry.object.userData.sceneEditorKind === 'primitive') entry.object.geometry?.dispose?.();
    }
    for (const object of this._colorOwnedObjects) {
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      materials.forEach((material) => material?.dispose?.());
    }
    this._colorOwnedObjects.clear();
  }

  exportProjectState() {
    return this._entries().map(({ id, object }) => ({
      id,
      ...objectTransform(object),
      ...(object.userData.sceneEditorKind === 'primitive' ? { primitive: { ...object.userData.primitiveDescriptor } } : {}),
      ...(this.getObjectColor(object) ? { color: this.getObjectColor(object) } : {}),
    }));
  }

  _validateSceneEdit(edit, index, seen) {
    if (!edit || typeof edit.id !== 'string' || !edit.id || edit.id.length > 256 || seen.has(edit.id)) throw new Error(`Sahne nesnesi #${index + 1} kimliği geçersiz veya yineleniyor.`);
    const vectors = [edit.position, edit.rotation, edit.scale];
    if (vectors.some((vector) => !vector || !['x', 'y', 'z'].every((axis) => Number.isFinite(Number(vector[axis]))))) throw new Error(`“${edit.id}” sahne dönüşümü geçersiz.`);
    if (['x', 'y', 'z'].some((axis) => Number(edit.scale[axis]) <= 0 || Number(edit.scale[axis]) > 1000)) throw new Error(`“${edit.id}” sahne ölçeği geçersiz.`);
    const color = edit.color === undefined ? null : normalizeColor(edit.color);
    if (edit.color !== undefined && !color) throw new Error(`“${edit.id}” nesne rengi geçersiz.`);
    let primitive = null;
    if (edit.primitive !== undefined) {
      if (!PRIMITIVE_TYPES.has(edit.primitive?.type)) throw new Error(`“${edit.id}” nesne türü desteklenmiyor.`);
      const dimension = (key) => {
        const value = Number(edit.primitive[key]);
        if (!Number.isFinite(value) || value <= 0 || value > 1000) throw new Error(`“${edit.id}” nesne ölçüsü geçersiz.`);
        return value;
      };
      primitive = {
        type: edit.primitive.type,
        width: dimension('width'),
        height: dimension('height'),
        depth: dimension('depth'),
        radius: dimension('radius'),
        color: normalizeColor(edit.primitive.color || color || '#b8b8b8'),
        name: String(edit.primitive.name || edit.id).trim().slice(0, 80) || edit.id,
      };
      if (!primitive.color) throw new Error(`“${edit.id}” şekil rengi geçersiz.`);
    }
    seen.add(edit.id);
    return {
      id: edit.id,
      position: Object.fromEntries(['x', 'y', 'z'].map((axis) => [axis, Number(edit.position[axis])])),
      rotation: Object.fromEntries(['x', 'y', 'z'].map((axis) => [axis, Number(edit.rotation[axis])])),
      scale: Object.fromEntries(['x', 'y', 'z'].map((axis) => [axis, Number(edit.scale[axis])])),
      ...(color ? { color } : {}),
      ...(primitive ? { primitive } : {}),
    };
  }

  restoreProjectState(edits = []) {
    if (!Array.isArray(edits) || edits.length > 500) throw new Error('Sahne düzenleme verisi geçersiz.');
    const seen = new Set();
    const normalized = edits.map((edit, index) => this._validateSceneEdit(edit, index, seen));
    const desiredPrimitiveIds = new Set(normalized.filter((edit) => edit.primitive).map((edit) => edit.id));
    for (const entry of this._entries()) {
      if (entry.object.userData.sceneEditorKind === 'primitive' && !desiredPrimitiveIds.has(entry.id)) this.removePrimitive(entry.id);
    }
    for (const edit of normalized) {
      if (!this._entries().some((entry) => entry.id === edit.id) && edit.primitive) {
        this.createPrimitive(edit.primitive.type, { ...edit.primitive, id: edit.id, position: { x: 0, y: 0.5, z: 0 } });
      }
    }
    const byId = new Map(normalized.map((edit) => [edit.id, edit]));
    for (const entry of this._entries()) {
      const edit = byId.get(entry.id);
      if (!edit) {
        if (entry.object.userData.sceneEditorDefaultTransform) this._applyTransform(entry, entry.object.userData.sceneEditorDefaultTransform);
        this._restoreOriginalMaterial(entry.object);
        continue;
      }
      this._applyTransform(entry, edit);
      const color = edit.color || edit.primitive?.color;
      if (color) this.setColor(edit.id, color);
      else this._restoreOriginalMaterial(entry.object);
      if (edit.primitive && entry.object.userData.sceneEditorKind === 'primitive') {
        entry.object.userData.primitiveDescriptor = { ...edit.primitive, color: color || edit.primitive.color };
        entry.object.userData.sceneEditorLabel = edit.primitive.name;
      }
    }
    this.undoStack.length = 0;
    this.redoStack.length = 0;
    this.collisionManager?.updateObstacleBoxes?.();
    this.onChange({ type: 'restored', objects: this.list(), selection: this.getSelection() });
    return this.exportProjectState();
  }
}
