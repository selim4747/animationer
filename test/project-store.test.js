import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateProjectBytes,
  createAutosaveRecord,
  IndexedProjectStore,
  MAX_CHARACTER_LIBRARY_BYTES,
  MAX_CHARACTER_MODEL_BYTES,
  MAX_CHARACTER_TEMPLATE_BYTES,
  MAX_PROJECT_BYTES,
  migrateProjectRecord,
  PROJECT_SCHEMA_VERSION,
  validateCharacterModelRecord,
  validateCharacterTemplateRecord,
  validateProjectRecord,
} from '../src/components/ProjectStore.js';

class MemoryIndexedDB {
  constructor() { this.stores = new Map(); this.data = new Map(); this.failNextWrite = false; }
  open() {
    const request = {};
    queueMicrotask(() => {
      request.result = {
        objectStoreNames: { contains: (name) => this.stores.has(name) },
        createObjectStore: (name) => { const data = new Map(); this.stores.set(name, data); if (name === 'projects') this.data = data; return data; },
        close() {},
        transaction: () => {
          const tx = { error: null, pending: 0, settled: false };
          const finish = () => {
            if (tx.pending === 0 && !tx.settled) {
              tx.settled = true;
              queueMicrotask(() => tx.oncomplete?.());
            }
          };
          tx.abort = () => { tx.settled = true; queueMicrotask(() => tx.onabort?.()); };
          tx.objectStore = (storeName) => {
            const data = this.stores.get(storeName);
            if (!data) throw new Error(`Unknown object store: ${storeName}`);
            return {
              put: (value, key) => {
                tx.pending++;
                queueMicrotask(() => {
                  if (this.failNextWrite) {
                    this.failNextWrite = false;
                    tx.error = new DOMException('Quota exceeded', 'QuotaExceededError');
                    tx.settled = true;
                    tx.onabort?.();
                  } else {
                    data.set(key, value);
                    tx.pending--;
                    finish();
                  }
                });
              },
              getAll: () => {
                const get = {};
                queueMicrotask(() => { get.result = [...data.values()]; get.onsuccess?.(); });
                return get;
              },
              getAllKeys: () => {
                const get = {};
                queueMicrotask(() => { get.result = [...data.keys()]; get.onsuccess?.(); });
                return get;
              },
              get: (key) => {
                const get = {};
                queueMicrotask(() => { get.result = data.get(key); get.onsuccess?.(); });
                return get;
              },
              delete: (key) => {
                tx.pending++;
                queueMicrotask(() => { data.delete(key); tx.pending--; finish(); });
              },
            };
          };
          return tx;
        },
      };
      request.onupgradeneeded?.();
      request.onsuccess?.();
    });
    return request;
  }
}

function createNativeFiles({ failWrites = false } = {}) {
  const files = new Map();
  let serial = 0;
  return {
    isEnabled: true,
    async initialize() { return true; },
    async writeBlob(blob, folder, fileName) {
      if (failWrites) throw new Error('disk full');
      const path = `Animationer/${folder}/${++serial}-${fileName}`;
      files.set(path, blob);
      return { storage: 'app-files', path, size: blob.size, mimeType: blob.type || 'application/octet-stream' };
    },
    async readBlob(ref, mimeType) {
      const blob = files.get(ref.path);
      if (!blob) throw new Error('file missing');
      return new Blob([await blob.arrayBuffer()], { type: mimeType || blob.type });
    },
    async writeJson(folder, fileName, value) {
      const path = `Animationer/${folder}/${++serial}-${fileName}`;
      files.set(path, JSON.stringify(value));
      return { storage: 'app-files', path, size: files.get(path).length, mimeType: 'application/json' };
    },
    async readJson(path) {
      const json = files.get(path);
      if (typeof json !== 'string') throw new Error('manifest missing');
      return JSON.parse(json);
    },
    async deleteFile(path) { files.delete(path); },
    async deleteDirectory(path) { for (const key of [...files.keys()]) if (key.startsWith(`${path}/`)) files.delete(key); },
    projectDirectory(id) { return `Animationer/projects/${String(id).replace(/[^a-zA-Z0-9._-]/g, '_')}`; },
    files,
  };
}

const v2 = (updatedAt = '2026-01-01T00:00:00.000Z') => ({
  schemaVersion: PROJECT_SCHEMA_VERSION,
  format: 'animationer-project',
  updatedAt,
  scope: { timeline: true, sprites2d: true },
  timeline: { version: '1.0.0', playMode: 'sequential', steps: [] },
  sprites: [{ id: 'sprite-1', blob: new Blob([new Uint8Array([1, 2, 3])]), fileName: 'sheet.png' }],
  viewport: { width: 320, height: 568 },
});

test('migrates legacy portable project v1 to explicit v4 storage schema', () => {
  const migrated = migrateProjectRecord({
    format: 'animationer-project', projectVersion: 1, version: '1.0.0', playMode: 'scheduled',
    timestamp: '2025-01-01T00:00:00.000Z', steps: [{ type: 'WAIT', data: { duration: 1 } }],
    sprites: [{ id: 'sprite-1', data: 'AQID', name: 'Sheet' }],
  });
  assert.equal(migrated.schemaVersion, 4);
  assert.equal(migrated.timeline.playMode, 'scheduled');
  assert.equal(migrated.timeline.steps.length, 1);
  assert.equal(migrated.scope.mapAssets, false);
  assert.equal(migrated.sprites[0].data, 'AQID');
  assert.deepEqual(migrated.worldCharacters, []);
  assert.equal(migrated.mapAsset, null);
});

test('migrates v2 autosaves without losing timeline and sprite data', () => {
  const migrated = migrateProjectRecord({ ...v2(), schemaVersion: 2, scope: { timeline: true, sprites2d: true }, projectVersion: 2 });
  assert.equal(migrated.schemaVersion, 4);
  assert.equal(migrated.sprites.length, 1);
  assert.deepEqual(migrated.worldCharacterTemplates, []);
  assert.deepEqual(migrated.worldCharacters, []);
});

test('rejects corrupt and unsupported project versions without changing the input', () => {
  const current = v2();
  assert.throws(() => migrateProjectRecord({ schemaVersion: 999 }), /desteklenmeyen/i);
  assert.throws(() => validateProjectRecord({ ...current, timeline: null }), /eksik/i);
  assert.equal(current.timeline.steps.length, 0);
});

test('records viewport metadata and rejects projects beyond the 100 MB limit', () => {
  const saved = createAutosaveRecord({ timeline: { steps: [] }, sprites: v2().sprites, viewport: { width: 320.4, height: 568.2 } });
  assert.deepEqual(saved.viewport, { width: 320, height: 568 });
  const oversizedBlob = new Blob(['x']);
  Object.defineProperty(oversizedBlob, 'size', { value: MAX_PROJECT_BYTES + 1 });
  assert.throws(() => validateProjectRecord({ ...saved, sprites: [{ id: 'large', blob: oversizedBlob }] }), /100 MB/i);
  assert.ok(calculateProjectBytes({ steps: [] }, [{ blob: { size: MAX_PROJECT_BYTES } }]) > MAX_PROJECT_BYTES);
});

test('v4 autosaves validate maps, placed 2D and 3D characters, and wall boxes', () => {
  const sheet = new Blob(['character'], { type: 'image/png' });
  const map = new Blob(['map'], { type: 'image/png' });
  const record = createAutosaveRecord({
    timeline: { steps: [] }, sprites: [], viewport: null,
    mapAsset: { kind: 'image', fileName: 'floor.png', blob: map, scale: 16, opacity: 0.8, groundOrientation: true },
    worldCharacterTemplates: [{ id: 'hero', name: 'Hero', blob: sheet, mimeType: 'image/png', fileName: 'hero.png', columns: 1, rows: 1, fps: 12 }],
    worldCharacters: [{ id: 'world2d-1', name: 'Hero 1', templateId: 'hero', x: 1, y: 0, z: -2 }],
    characters3d: [{ id: 'character-1', name: 'Hero', modelId: null, position: { x: 1, y: 0, z: -2 }, rotationY: 0, walkSpeed: 4.2, wobbleIntensity: 1, visible: true }],
    wallBoxes: [{ x: 1, z: 2, width: 3, depth: 2, height: 1 }],
  });
  assert.equal(record.scope.mapAssets, true);
  assert.equal(record.scope.worldCharacters, true);
  assert.equal(record.characters3d.length, 1);
  assert.equal(record.wallBoxes.length, 1);
  assert.equal(calculateProjectBytes(record.timeline, record.sprites, record.mapAsset, record.worldCharacterTemplates), map.size + sheet.size + new TextEncoder().encode(JSON.stringify(record.timeline)).byteLength);
  assert.throws(() => validateProjectRecord({ ...record, worldCharacters: [{ ...record.worldCharacters[0], templateId: 'missing' }] }), /kaynak spritesheet eksik/i);
});

test('named projects can be created, renamed, duplicated, listed and deleted independently', async () => {
  const store = new IndexedProjectStore(new MemoryIndexedDB());
  const first = await store.createProject('  Studio A  ');
  const second = await store.createProject('Studio B');
  assert.equal(first.name, 'Studio A');
  assert.notEqual(first.projectId, second.projectId);
  assert.equal(first.characters3d.length, 1);
  const renamed = await store.renameProject(first.projectId, 'Studio Renamed');
  assert.equal(renamed.name, 'Studio Renamed');
  const copy = await store.duplicateProject(first.projectId, 'Studio Copy');
  assert.notEqual(copy.projectId, first.projectId);
  assert.equal(copy.characters3d.length, first.characters3d.length);
  assert.deepEqual((await store.listProjects()).map(({ name }) => name).sort(), ['Studio B', 'Studio Copy', 'Studio Renamed']);
  await store.deleteProject(second.projectId);
  assert.equal(await store.loadProject(second.projectId), null);
  assert.equal((await store.listProjects()).length, 2);
});

test('3D GLB models persist in the shared library and remain protected while a project uses them', async () => {
  const store = new IndexedProjectStore(new MemoryIndexedDB());
  const model = await store.saveCharacterModel({ id: 'model-hero', name: 'Hero', fileName: 'hero.glb', blob: new Blob(['glb'], { type: 'model/gltf-binary' }) });
  assert.equal(model.name, 'Hero');
  assert.equal((await store.listCharacterModelMetadata())[0].id, model.id);
  assert.equal('blob' in (await store.listCharacterModelMetadata())[0], false);
  const project = await store.createProject('Uses hero');
  const used = { ...project, characters3d: project.characters3d.map((actor) => ({ ...actor, modelId: model.id })) };
  await store.saveProject(project.projectId, used);
  await assert.rejects(() => store.deleteCharacterModel(model.id), /uses hero/i);
  assert.ok(await store.getCharacterModel(model.id));
  const oversized = new Blob(['x']);
  Object.defineProperty(oversized, 'size', { value: MAX_CHARACTER_MODEL_BYTES + 1 });
  assert.throws(() => validateCharacterModelRecord({ id: 'large', name: 'Large', fileName: 'large.glb', blob: oversized }), /50 MB/i);
});

test('IndexedDB autosave rolls back a quota failure and preserves the last valid record', async () => {
  const db = new MemoryIndexedDB();
  const store = new IndexedProjectStore(db);
  const initial = v2('2026-01-01T00:00:00.000Z');
  await store.save(initial);
  db.failNextWrite = true;
  await assert.rejects(() => store.save(v2('2026-01-02T00:00:00.000Z')), /kotası dolu/i);
  const restored = await store.load();
  assert.equal(restored.updatedAt, initial.updatedAt);
  await store.clear();
  assert.equal(await store.load(), null);
});

test('named 2D character templates persist in a separate library and can be deleted', async () => {
  const store = new IndexedProjectStore(new MemoryIndexedDB());
  const template = await store.saveCharacterTemplate({
    id: 'template-hero', name: '  Hero  ', blob: new Blob(['png'], { type: 'image/png' }),
    mimeType: 'image/png', fileName: 'hero.png', columns: 4, rows: 4, fps: 12,
  });
  assert.equal(template.name, 'Hero');
  assert.deepEqual((await store.listCharacterTemplates()).map(({ id, name }) => ({ id, name })), [
    { id: 'template-hero', name: 'Hero' },
  ]);
  assert.equal(await store.deleteCharacterTemplate('template-hero'), true);
  assert.deepEqual(await store.listCharacterTemplates(), []);
});

test('metadata-only library listing omits Blob payloads and skips one corrupt record', async () => {
  const db = new MemoryIndexedDB();
  const store = new IndexedProjectStore(db);
  await store.saveCharacterTemplate({ id: 'good', name: 'Good', blob: new Blob(['png'], { type: 'image/png' }), mimeType: 'image/png', fileName: 'good.png', columns: 1, rows: 1, fps: 12 });
  db.stores.get('character-library').set('bad', { id: 'bad', name: '', blob: new Blob(['bad']) });
  const skipped = [];
  const records = await store.listCharacterTemplateMetadata({ onInvalid: (record) => skipped.push(record.id) });
  assert.deepEqual(records.map(({ id }) => id), ['good']);
  assert.equal('blob' in records[0], false);
  assert.deepEqual(skipped, ['bad']);
});

test('2D character template and library limits are enforced before saving', async () => {
  const makeBlob = (size) => {
    const blob = new Blob(['x'], { type: 'image/png' });
    Object.defineProperty(blob, 'size', { value: size });
    return blob;
  };
  assert.throws(() => validateCharacterTemplateRecord({ id: 'bad', name: 'Bad', blob: makeBlob(MAX_CHARACTER_TEMPLATE_BYTES + 1), mimeType: 'image/png', columns: 1, rows: 1, fps: 12 }), /50 MB/i);

  const store = new IndexedProjectStore(new MemoryIndexedDB());
  for (let index = 0; index < 5; index++) {
    await store.saveCharacterTemplate({ id: `template-${index}`, name: `Hero ${index}`, blob: makeBlob(MAX_CHARACTER_TEMPLATE_BYTES), mimeType: 'image/png', columns: 1, rows: 1, fps: 12 });
  }
  assert.equal(5 * MAX_CHARACTER_TEMPLATE_BYTES, MAX_CHARACTER_LIBRARY_BYTES);
  await assert.rejects(() => store.saveCharacterTemplate({ id: 'template-overflow', name: 'Overflow', blob: makeBlob(1), mimeType: 'image/png', columns: 1, rows: 1, fps: 12 }), /250 MB/i);
  const phoneStore = new IndexedProjectStore(new MemoryIndexedDB());
  await assert.rejects(() => phoneStore.saveCharacterTemplate({ id: 'phone-overflow', name: 'Phone', blob: makeBlob(2), mimeType: 'image/png', columns: 1, rows: 1, fps: 12 }, { maxLibraryBytes: 1 }), /1 MB/i);
  assert.equal((await store.listCharacterTemplates()).length, 5);
});

test('native project records keep binary assets in app files and hydrate only when the project opens', async () => {
  const db = new MemoryIndexedDB();
  const fileStore = createNativeFiles();
  const store = new IndexedProjectStore(db, { fileStore });
  const input = { ...v2(), projectId: 'native-project' };
  await store.saveProject('native-project', input);
  const stored = db.stores.get('projects').get('project:native-project');
  assert.equal(stored.nativeProject, true);
  assert.equal('sprites' in stored, false);
  const manifest = await fileStore.readJson(stored.manifestPath);
  assert.equal(manifest.sprites[0].blob, undefined);
  assert.equal(manifest.sprites[0].fileRef.storage, 'app-files');
  const loaded = await store.loadProject('native-project');
  assert.equal(loaded.sprites[0].blob.size, input.sprites[0].blob.size);
  assert.equal(new TextDecoder().decode(await loaded.sprites[0].blob.arrayBuffer()), '\u0001\u0002\u0003');
  assert.equal((await store.loadProject('native-project', { hydrateAssets: false })).sprites[0].blob, undefined);
});

test('native character libraries store file references and ignore browser-only total library limits', async () => {
  const db = new MemoryIndexedDB();
  const fileStore = createNativeFiles();
  const store = new IndexedProjectStore(db, { fileStore });
  await store.saveCharacterTemplate({ id: 'native-sheet', name: 'Sheet', blob: new Blob(['png'], { type: 'image/png' }), mimeType: 'image/png', fileName: 'sheet.png', columns: 1, rows: 1, fps: 12 }, { maxLibraryBytes: 1 });
  await store.saveCharacterModel({ id: 'native-model', name: 'Model', blob: new Blob(['glb'], { type: 'model/gltf-binary' }), fileName: 'model.glb' }, { maxLibraryBytes: 1 });
  assert.equal(db.stores.get('character-library').get('native-sheet').blob, undefined);
  assert.equal(db.stores.get('character-models').get('native-model').blob, undefined);
  assert.equal((await store.listCharacterTemplateMetadata())[0].blobSize, 3);
  assert.equal((await store.listCharacterModelMetadata())[0].blobSize, 3);
  assert.equal((await store.getCharacterTemplate('native-sheet')).blob.size, 3);
  assert.equal((await store.getCharacterModel('native-model')).blob.size, 3);
  const fiftyMiBBlob = new Blob(['x'], { type: 'image/png' });
  Object.defineProperty(fiftyMiBBlob, 'size', { value: MAX_CHARACTER_TEMPLATE_BYTES });
  for (let index = 0; index < 6; index += 1) {
    await store.saveCharacterTemplate({ id: `unbounded-${index}`, name: `Character ${index}`, blob: fiftyMiBBlob, mimeType: 'image/png', fileName: `c${index}.png`, columns: 1, rows: 1, fps: 12 }, { maxLibraryBytes: 1 });
  }
  assert.ok(6 * MAX_CHARACTER_TEMPLATE_BYTES > MAX_CHARACTER_LIBRARY_BYTES);
  assert.equal((await store.listCharacterTemplateMetadata()).length, 7);
  const fiftyMiBModel = new Blob(['x'], { type: 'model/gltf-binary' });
  Object.defineProperty(fiftyMiBModel, 'size', { value: MAX_CHARACTER_MODEL_BYTES });
  for (let index = 0; index < 6; index += 1) {
    await store.saveCharacterModel({ id: `unbounded-model-${index}`, name: `Model ${index}`, blob: fiftyMiBModel, fileName: `m${index}.glb` }, { maxLibraryBytes: 1 });
  }
  assert.equal((await store.listCharacterModelMetadata()).length, 7);
});

test('native project storage bypasses the fixed browser project-size ceiling', async () => {
  const db = new MemoryIndexedDB();
  const fileStore = createNativeFiles();
  const store = new IndexedProjectStore(db, { fileStore });
  const oversized = new Blob(['x'], { type: 'image/png' });
  Object.defineProperty(oversized, 'size', { value: MAX_PROJECT_BYTES + 1 });
  const record = { ...v2(), projectId: 'large-native', sprites: [{ id: 'large', fileName: 'large.png', blob: oversized }] };
  await store.saveProject('large-native', record);
  const pointer = db.stores.get('projects').get('project:large-native');
  const manifest = await fileStore.readJson(pointer.manifestPath);
  assert.equal(manifest.sprites[0].fileRef.size, MAX_PROJECT_BYTES + 1);
});

test('native migration converts legacy project and library Blobs while preserving file-backed access', async () => {
  const db = new MemoryIndexedDB();
  const browserStore = new IndexedProjectStore(db);
  await browserStore.saveProject('legacy-project', { ...v2(), projectId: 'legacy-project' });
  await browserStore.saveCharacterTemplate({ id: 'legacy-sheet', name: 'Legacy', blob: new Blob(['sprite'], { type: 'image/png' }), mimeType: 'image/png', fileName: 'legacy.png', columns: 1, rows: 1, fps: 12 });
  const fileStore = createNativeFiles();
  const androidStore = new IndexedProjectStore(db, { fileStore });
  await androidStore.listProjects();
  await androidStore.listCharacterTemplateMetadata();
  assert.equal(db.stores.get('projects').get('project:legacy-project').nativeProject, true);
  assert.equal(db.stores.get('character-library').get('legacy-sheet').blob, undefined);
  assert.equal((await androidStore.loadProject('legacy-project')).sprites[0].blob.size, 3);
  assert.equal((await androidStore.getCharacterTemplate('legacy-sheet')).blob.size, 6);
});

test('native migration leaves source IndexedDB data intact when file copying fails', async () => {
  const db = new MemoryIndexedDB();
  const browserStore = new IndexedProjectStore(db);
  await browserStore.saveProject('safe-project', { ...v2(), projectId: 'safe-project' });
  const original = db.stores.get('projects').get('project:safe-project');
  const androidStore = new IndexedProjectStore(db, { fileStore: createNativeFiles({ failWrites: true }) });
  await assert.rejects(() => androidStore.listProjects(), /disk full/i);
  const after = db.stores.get('projects').get('project:safe-project');
  assert.equal(after.sprites[0].blob.size, original.sprites[0].blob.size);
  assert.equal(after.nativeProject, undefined);
});
