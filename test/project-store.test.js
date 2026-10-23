import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateProjectBytes,
  createAutosaveRecord,
  IndexedProjectStore,
  MAX_PROJECT_BYTES,
  migrateProjectRecord,
  PROJECT_SCHEMA_VERSION,
  validateProjectRecord,
} from '../src/components/ProjectStore.js';

class MemoryIndexedDB {
  constructor() { this.data = new Map(); this.failNextWrite = false; }
  open() {
    const request = {};
    queueMicrotask(() => {
      request.result = {
        objectStoreNames: { contains: (name) => name === 'projects' },
        createObjectStore() {},
        close() {},
        transaction: () => {
          const tx = { error: null };
          tx.objectStore = () => ({
            put: (value, key) => {
              queueMicrotask(() => {
                if (this.failNextWrite) {
                  this.failNextWrite = false;
                  tx.error = new DOMException('Quota exceeded', 'QuotaExceededError');
                  tx.onabort?.();
                } else {
                  this.data.set(key, value);
                  tx.oncomplete?.();
                }
              });
            },
            get: (key) => {
              const get = {};
              queueMicrotask(() => { get.result = this.data.get(key); get.onsuccess?.(); });
              return get;
            },
            delete: (key) => {
              queueMicrotask(() => { this.data.delete(key); tx.oncomplete?.(); });
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

test('migrates legacy portable project v1 to explicit v2 storage schema', () => {
  const migrated = migrateProjectRecord({
    format: 'animationer-project', projectVersion: 1, version: '1.0.0', playMode: 'scheduled',
    timestamp: '2025-01-01T00:00:00.000Z', steps: [{ type: 'WAIT', data: { duration: 1 } }],
    sprites: [{ id: 'sprite-1', data: 'AQID', name: 'Sheet' }],
  });
  assert.equal(migrated.schemaVersion, 2);
  assert.equal(migrated.timeline.playMode, 'scheduled');
  assert.equal(migrated.timeline.steps.length, 1);
  assert.equal(migrated.scope.mapAssets, false);
  assert.equal(migrated.sprites[0].data, 'AQID');
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
