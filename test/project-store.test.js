import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateProjectBytes,
  createAutosaveRecord,
  IndexedProjectStore,
  MAX_CHARACTER_LIBRARY_BYTES,
  MAX_CHARACTER_TEMPLATE_BYTES,
  MAX_PROJECT_BYTES,
  migrateProjectRecord,
  PROJECT_SCHEMA_VERSION,
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
        transaction: (storeName) => {
          const tx = { error: null };
          tx.abort = () => queueMicrotask(() => tx.onabort?.());
          const data = this.stores.get(storeName);
          tx.objectStore = () => ({
            put: (value, key) => {
              queueMicrotask(() => {
                if (this.failNextWrite) {
                  this.failNextWrite = false;
                  tx.error = new DOMException('Quota exceeded', 'QuotaExceededError');
                  tx.onabort?.();
                } else {
                  data.set(key, value);
                  tx.oncomplete?.();
                }
              });
            },
            getAll: () => {
              const get = {};
              queueMicrotask(() => { get.result = [...data.values()]; get.onsuccess?.(); });
              return get;
            },
            get: (key) => {
              const get = {};
              queueMicrotask(() => { get.result = data.get(key); get.onsuccess?.(); });
              return get;
            },
            delete: (key) => {
              queueMicrotask(() => { data.delete(key); tx.oncomplete?.(); });
            },
          });
          return tx;
        },
      };
      request.onupgradeneeded?.();
      request.onsuccess?.();
    });
    return request;
  }
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

test('migrates legacy portable project v1 to explicit v3 storage schema', () => {
  const migrated = migrateProjectRecord({
    format: 'animationer-project', projectVersion: 1, version: '1.0.0', playMode: 'scheduled',
    timestamp: '2025-01-01T00:00:00.000Z', steps: [{ type: 'WAIT', data: { duration: 1 } }],
    sprites: [{ id: 'sprite-1', data: 'AQID', name: 'Sheet' }],
  });
  assert.equal(migrated.schemaVersion, 3);
  assert.equal(migrated.timeline.playMode, 'scheduled');
  assert.equal(migrated.timeline.steps.length, 1);
  assert.equal(migrated.scope.mapAssets, false);
  assert.equal(migrated.sprites[0].data, 'AQID');
  assert.deepEqual(migrated.worldCharacters, []);
  assert.equal(migrated.mapAsset, null);
});

test('migrates v2 autosaves without losing timeline and sprite data', () => {
  const migrated = migrateProjectRecord({ ...v2(), schemaVersion: 2, scope: { timeline: true, sprites2d: true }, projectVersion: 2 });
  assert.equal(migrated.schemaVersion, 3);
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

test('v3 autosaves validate and account for a 2D environment and placed characters', () => {
  const sheet = new Blob(['character'], { type: 'image/png' });
  const map = new Blob(['map'], { type: 'image/png' });
  const record = createAutosaveRecord({
    timeline: { steps: [] }, sprites: [], viewport: null,
    mapAsset: { kind: 'image', fileName: 'floor.png', blob: map, scale: 16, opacity: 0.8, groundOrientation: true },
    worldCharacterTemplates: [{ id: 'hero', name: 'Hero', blob: sheet, mimeType: 'image/png', fileName: 'hero.png', columns: 1, rows: 1, fps: 12 }],
    worldCharacters: [{ id: 'world2d-1', name: 'Hero 1', templateId: 'hero', x: 1, y: 0, z: -2 }],
  });
  assert.equal(record.scope.mapAssets, true);
  assert.equal(record.scope.worldCharacters, true);
  assert.equal(calculateProjectBytes(record.timeline, record.sprites, record.mapAsset, record.worldCharacterTemplates), map.size + sheet.size + new TextEncoder().encode(JSON.stringify(record.timeline)).byteLength);
  assert.throws(() => validateProjectRecord({ ...record, worldCharacters: [{ ...record.worldCharacters[0], templateId: 'missing' }] }), /kaynak spritesheet eksik/i);
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
