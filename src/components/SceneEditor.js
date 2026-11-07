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
    this.selectedIds = [];
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
      if (!id || !object?.isObject3D) return;
      if (!object.userData.sceneEditorDefaultTransform) object.userData.sceneEditorDefaultTransform = objectTransform(object);
      if (object.userData.sceneEditorDefaultVisible === undefined) object.userData.sceneEditorDefaultVisible = object.visible !== false;
      if (object.userData.sceneEditorDefaultLocked === undefined) object.userData.sceneEditorDefaultLocked = object.userData.sceneEditorLocked === true;
      if (object.userData.sceneEditorDefaultLabel === undefined) object.userData.sceneEditorDefaultLabel = object.userData.sceneEditorLabel || object.name || id;
      let depth = 0;
      let parent = object.parent;
      let parentId = null;
      const ancestorIds = [];
      while (parent) {
        if (parent.userData?.sceneEditorId) {
          depth += 1;
          parentId ||= parent.userData.sceneEditorId;
          ancestorIds.push(parent.userData.sceneEditorId);
        }
        parent = parent.parent;
      }
      entries.push({ id, object, raycastRoot, label: object.userData.sceneEditorLabel || label, kind, depth, parentId, ancestorIds, visible: object.visible !== false, locked: object.userData.sceneEditorLocked === true });
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

  list() { return this._entries().map(({ id, label, kind, depth, parentId, visible, locked }) => ({ id, label, kind, depth, parentId, visible, locked })); }

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
    const entries = this._entries();
    const entry = entries.find((item) => item.id === this.selectedId && !item.ancestorIds.some((id) => this.selectedIds.includes(id)))
      || entries.find((item) => this.selectedIds.includes(item.id) && !item.ancestorIds.some((id) => this.selectedIds.includes(id)));
    return entry ? {
      id: entry.id,
      label: entry.label,
      kind: entry.kind,
      transform: objectTransform(entry.object),
      color: this.getObjectColor(entry.object),
      mode: this.mode,
      locked: entry.locked,
      ids: [...this.selectedIds],
      count: this.selectedIds.length,
    } : null;
  }

  select(id, { additive = false, toggle = false } = {}) {
    const entry = this._entries().find((item) => item.id === id) || null;
    if (additive && entry) {
      const selected = new Set(this.selectedIds);
      if (toggle && selected.has(entry.id)) selected.delete(entry.id);
      else selected.add(entry.id);
      this.selectedIds = [...selected];
      this.selectedId = selected.has(entry.id) ? entry.id : (this.selectedIds.at(-1) || null);
    } else {
      this.selectedId = entry?.id || null;
      this.selectedIds = entry ? [entry.id] : [];
    }
    this.onChange({ type: 'selection', active: this.active, objects: this.list(), selection: this.getSelection() });
    return this.getSelection();
  }

  selectMany(ids = []) {
    const available = new Set(this._entries().map((entry) => entry.id));
    this.selectedIds = [...new Set(ids)].filter((id) => available.has(id));
    this.selectedId = this.selectedIds.at(-1) || null;
    this.onChange({ type: 'selection', active: this.active, objects: this.list(), selection: this.getSelection() });
    return this.getSelection();
  }

  selectAt(clientX, clientY) {
    if (!this.active || !this.domElement || !this.camera) return false;
    const rect = this.domElement.getBoundingClientRect();
    if (!rect.width || !rect.height) return false;
    this.pointer.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const entries = this._entries().filter((entry) => entry.visible && !entry.locked);
    const hit = this.raycaster.intersectObjects(entries.map((entry) => entry.raycastRoot), true)[0];
    if (!hit) {
      this.select(null);
      return true;
    }
    let match = entries.find((entry) => entry.object === hit.object || entry.object === hit.object.parent);
    if (!match) match = entries.find((entry) => entry.object === hit.object || entry.object.getObjectById?.(hit.object.id));
    this.select(match?.id || null, { additive: false });
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
    if (!entry || entry.locked) return false;
    const before = objectTransform(entry.object);
    this._applyTransform(entry, transform);
    const after = objectTransform(entry.object);
    this._pushHistory([{ id: entry.id, transform: before }], [{ id: entry.id, transform: after }]);
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
    if (snapshot.kind === 'primitive-batch-add') {
      if (source === this.undoStack) {
        const entries = snapshot.ids.map((id) => this._entries().find((entry) => entry.id === id));
        if (entries.some((entry) => !entry || entry.object.userData.sceneEditorKind !== 'primitive')) { source.push(snapshot); return false; }
        for (const entry of entries) {
          entry.object.parent?.remove(entry.object);
          entry.object.geometry?.dispose?.();
          const materials = Array.isArray(entry.object.material) ? entry.object.material : [entry.object.material];
          materials.forEach((material) => material?.dispose?.());
          this._originalMaterials.delete(entry.object);
          this._colorOwnedObjects.delete(entry.object);
        }
        this.selectedIds = this.selectedIds.filter((id) => !snapshot.ids.includes(id));
        if (!this.selectedIds.includes(this.selectedId)) this.selectedId = this.selectedIds.at(-1) || null;
      } else {
        try { this.addPrimitiveBatch(snapshot.edits, { recordHistory: false, notify: false }); }
        catch { source.push(snapshot); return false; }
      }
      destination.push(snapshot);
      if (destination.length > this.historyLimit) destination.shift();
      this.collisionManager?.updateObstacleBoxes?.();
      this.onChange({ type: source === this.undoStack ? 'template-removed' : 'template-added', active: this.active, objects: this.list(), selection: this.getSelection() });
      return true;
    }
    const changes = Array.isArray(snapshot) ? snapshot : [{ id: snapshot.id, transform: snapshot.transform }];
    const entries = this._entries();
    const current = changes.map((change) => {
      const entry = entries.find((item) => item.id === change.id);
      return entry ? { id: entry.id, transform: objectTransform(entry.object) } : null;
    });
    if (current.some((item) => !item)) { source.push(snapshot); return false; }
    destination.push(current);
    if (destination.length > this.historyLimit) destination.shift();
    changes.forEach((change) => {
      const entry = entries.find((item) => item.id === change.id);
      this._applyTransform(entry, change.transform);
    });
    this.onChange({ type: 'transform', active: this.active, objects: this.list(), selection: this.getSelection() });
    return true;
  }

  setSelectionTransform(transform = {}) {
    for (const key of ['position', 'rotation', 'scale']) {
      if (transform[key] && !['x', 'y', 'z'].every((axis) => Number.isFinite(Number(transform[key][axis])))) return false;
    }
    const entries = this._entries().filter((entry) => this.selectedIds.includes(entry.id) && !entry.ancestorIds.some((id) => this.selectedIds.includes(id)));
    if (!entries.length || entries.some((entry) => entry.locked)) return false;
    const primary = entries.find((entry) => entry.id === this.selectedId) || entries[0];
    const primaryBefore = objectTransform(primary.object);
    const before = entries.map((entry) => ({ id: entry.id, transform: objectTransform(entry.object) }));
    let worldPositionDelta = null;
    if (transform.position) {
      const localDelta = new THREE.Vector3(
        Number(transform.position.x) - primaryBefore.position.x,
        Number(transform.position.y) - primaryBefore.position.y,
        Number(transform.position.z) - primaryBefore.position.z,
      );
      worldPositionDelta = localDelta.clone();
      if (primary.object.parent) {
        primary.object.parent.updateWorldMatrix(true, false);
        const origin = primary.object.parent.localToWorld(new THREE.Vector3(0, 0, 0));
        const endpoint = primary.object.parent.localToWorld(localDelta.clone());
        worldPositionDelta = endpoint.sub(origin);
      }
    }
    for (const entry of entries) {
      const current = objectTransform(entry.object);
      const next = { position: {}, rotation: {}, scale: {} };
      for (const axis of ['x', 'y', 'z']) {
        if (transform.rotation) next.rotation[axis] = current.rotation[axis] + (Number(transform.rotation[axis]) - primaryBefore.rotation[axis]);
        if (transform.scale) next.scale[axis] = current.scale[axis] * (Number(transform.scale[axis]) / primaryBefore.scale[axis]);
      }
      if (worldPositionDelta) {
        const worldPosition = entry.object.getWorldPosition(new THREE.Vector3()).add(worldPositionDelta);
        if (entry.object.parent) {
          entry.object.parent.updateWorldMatrix(true, false);
          entry.object.parent.worldToLocal(worldPosition);
        }
        next.position = { x: worldPosition.x, y: worldPosition.y, z: worldPosition.z };
      }
      this._applyTransform(entry, next);
    }
    const after = entries.map((entry) => ({ id: entry.id, transform: objectTransform(entry.object) }));
    this._pushHistory(before, after);
    this.onChange({ type: 'transform', active: this.active, objects: this.list(), selection: this.getSelection() });
    return true;
  }

  renameObject(id, label) {
    const entry = this._entries().find((item) => item.id === id);
    const clean = typeof label === 'string' ? label.trim().slice(0, 80) : '';
    if (!entry || !clean) return false;
    entry.object.userData.sceneEditorLabel = clean;
    if (entry.kind === 'primitive') entry.object.userData.primitiveDescriptor.name = clean;
    this.onChange({ type: 'object-renamed', objects: this.list(), selection: this.getSelection() });
    return true;
  }

  setObjectVisible(id, visible) {
    const entry = this._entries().find((item) => item.id === id);
    if (!entry) return false;
    const nextVisible = Boolean(visible);
    if (entry.kind === 'map') this.mapLoader?.setMeshVisible?.(entry.id.slice('map:'.length), nextVisible);
    else entry.object.visible = nextVisible;
    this.collisionManager?.updateObstacleBoxes?.();
    this.onChange({ type: 'object-visibility', objects: this.list(), selection: this.getSelection() });
    return true;
  }

  setObjectLocked(id, locked) {
    const entry = this._entries().find((item) => item.id === id);
    if (!entry) return false;
    entry.object.userData.sceneEditorLocked = Boolean(locked);
    this.onChange({ type: 'object-lock', objects: this.list(), selection: this.getSelection() });
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
    if (!entry || entry.locked || !normalized) return false;
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
    if (!options.silent) this.onChange({ type: 'primitive-added', active: this.active, objects: this.list(), selection: this.getSelection() });
    return object;
  }

  addPrimitiveBatch(edits = [], { recordHistory = true, notify = true } = {}) {
    if (!Array.isArray(edits) || !edits.length || edits.length > 500 || this._entries().length + edits.length > 500) {
      throw new Error('Sahne şablonu nesne sınırını aşıyor.');
    }
    const seen = new Set(this._entries().map((entry) => entry.id));
    const normalized = edits.map((edit, index) => {
      const value = this._validateSceneEdit(edit, index, seen);
      if (!value.primitive) throw new Error(`Şablon nesnesi #${index + 1} bir primitive tanımı içermiyor.`);
      if (['x', 'y', 'z'].some((axis) => Math.abs(value.position[axis]) > 10000)) throw new Error(`Şablon nesnesi #${index + 1} konumu ±10000 aralığında olmalı.`);
      return value;
    });
    const added = [];
    try {
      for (const edit of normalized) {
        const object = this.createPrimitive(edit.primitive.type, { ...edit.primitive, id: edit.id, position: edit.position, silent: true });
        object.rotation.set(edit.rotation.x, edit.rotation.y, edit.rotation.z);
        object.scale.set(edit.scale.x, edit.scale.y, edit.scale.z);
        object.visible = edit.visible !== false;
        object.userData.sceneEditorLocked = edit.locked === true;
        object.userData.sceneEditorLabel = edit.label || edit.primitive.name;
        added.push(object);
      }
    } catch (error) {
      for (const object of added) {
        object.parent?.remove(object);
        object.geometry?.dispose?.();
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        materials.forEach((material) => material?.dispose?.());
      }
      throw error;
    }
    const ids = added.map((object) => object.userData.sceneEditorId);
    if (recordHistory) {
      const idSet = new Set(ids);
      this.undoStack.push({ kind: 'primitive-batch-add', ids, edits: this.exportProjectState().filter((edit) => idSet.has(edit.id)) });
      if (this.undoStack.length > this.historyLimit) this.undoStack.shift();
      this.redoStack.length = 0;
    }
    this.collisionManager?.updateObstacleBoxes?.();
    if (notify) this.onChange({ type: 'template-added', active: this.active, objects: this.list(), selection: this.getSelection() });
    return ids;
  }

  removePrimitive(id = this.selectedId) {
    const entry = this._entries().find((item) => item.id === id);
    if (!entry || entry.locked || entry.object.userData.sceneEditorKind !== 'primitive') return false;
    entry.object.parent?.remove(entry.object);
    entry.object.geometry?.dispose?.();
    const materials = Array.isArray(entry.object.material) ? entry.object.material : [entry.object.material];
    materials.forEach((material) => material?.dispose?.());
    this._originalMaterials.delete(entry.object);
    this._colorOwnedObjects.delete(entry.object);
    const references = (snapshot) => snapshot?.kind === 'primitive-batch-add'
      ? snapshot.ids.includes(id)
      : Array.isArray(snapshot) ? snapshot.some((item) => item.id === id) : snapshot.id === id;
    this.undoStack = this.undoStack.filter((snapshot) => !references(snapshot));
    this.redoStack = this.redoStack.filter((snapshot) => !references(snapshot));
    this.selectedIds = this.selectedIds.filter((selectedId) => selectedId !== id);
    if (this.selectedId === id) this.selectedId = this.selectedIds.at(-1) || null;
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
      label: object.userData.sceneEditorLabel || object.name || id,
      visible: object.visible !== false,
      locked: object.userData.sceneEditorLocked === true,
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
      ...(typeof edit.label === 'string' ? { label: edit.label.trim().slice(0, 80) || edit.id } : {}),
      ...(typeof edit.visible === 'boolean' ? { visible: edit.visible } : {}),
      ...(typeof edit.locked === 'boolean' ? { locked: edit.locked } : {}),
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
        const defaultVisible = entry.object.userData.sceneEditorDefaultVisible !== false;
        if (entry.kind === 'map') this.mapLoader?.setMeshVisible?.(entry.id.slice('map:'.length), defaultVisible, { notify: false });
        else entry.object.visible = defaultVisible;
        entry.object.userData.sceneEditorLocked = entry.object.userData.sceneEditorDefaultLocked === true;
        entry.object.userData.sceneEditorLabel = entry.object.userData.sceneEditorDefaultLabel;
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
      if (edit.label) entry.object.userData.sceneEditorLabel = edit.label;
      if (edit.visible !== undefined) {
        if (entry.kind === 'map') this.mapLoader?.setMeshVisible?.(entry.id.slice('map:'.length), edit.visible, { notify: false });
        else entry.object.visible = edit.visible;
      }
      if (edit.locked !== undefined) entry.object.userData.sceneEditorLocked = edit.locked;
    }
    this.undoStack.length = 0;
    this.redoStack.length = 0;
    this.collisionManager?.updateObstacleBoxes?.();
    this.selectedIds = this.selectedIds.filter((id) => this._entries().some((entry) => entry.id === id));
    if (!this.selectedIds.includes(this.selectedId)) this.selectedId = this.selectedIds.at(-1) || null;
    this.onChange({ type: 'restored', objects: this.list(), selection: this.getSelection() });
    return this.exportProjectState();
  }
}
