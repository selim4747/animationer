import test from 'node:test';
import assert from 'node:assert/strict';
import { AppPrivateFileStore } from '../src/storage/AppPrivateFileStore.js';

const toBase64 = (bytes) => Buffer.from(bytes).toString('base64');

class MemoryFilesystem {
  constructor() { this.files = new Map(); this.directories = new Set(); this.writeCalls = 0; this.appendCalls = 0; }
  async mkdir({ path }) { this.directories.add(path); }
  async writeFile({ path, data, encoding }) {
    this.writeCalls += 1;
    this.files.set(path, encoding === 'utf8' ? Buffer.from(data) : Buffer.from(data, 'base64'));
    return { uri: `file://${path}` };
  }
  async appendFile({ path, data }) {
    this.appendCalls += 1;
    if (!this.files.has(path)) throw new Error('File does not exist');
    this.files.set(path, Buffer.concat([this.files.get(path), Buffer.from(data, 'base64')]));
  }
  async stat({ path }) {
    const file = this.files.get(path);
    if (!file) throw new Error('File does not exist');
    return { size: file.length };
  }
  async rename({ from, to }) {
    const file = this.files.get(from);
    if (!file) throw new Error('File does not exist');
    this.files.set(to, file);
    this.files.delete(from);
  }
  async readFile({ path, offset = 0, length = -1, encoding }) {
    const file = this.files.get(path);
    if (!file) throw new Error('File does not exist');
    const bytes = file.subarray(offset, length < 0 ? undefined : offset + length);
    return { data: encoding === 'utf8' ? bytes.toString('utf8') : toBase64(bytes) };
  }
  async deleteFile({ path }) {
    if (!this.files.delete(path)) throw new Error('File does not exist');
  }
  async rmdir({ path }) {
    for (const key of [...this.files.keys()]) if (key.startsWith(`${path}/`)) this.files.delete(key);
    for (const key of [...this.directories]) if (key === path || key.startsWith(`${path}/`)) this.directories.delete(key);
  }
}

function createStore(filesystem = new MemoryFilesystem()) {
  return { store: new AppPrivateFileStore({ filesystem, directory: 'DATA', root: 'Animationer', native: true, platform: 'android' }), filesystem };
}

test('creates the app-private Animationer directory tree on initialize', async () => {
  const { store, filesystem } = createStore();
  assert.equal(await store.initialize(), true);
  for (const path of ['Animationer', 'Animationer/projects', 'Animationer/character-library', 'Animationer/character-library/2d', 'Animationer/character-library/3d', 'Animationer/temporary']) {
    assert.ok(filesystem.directories.has(path), `missing ${path}`);
  }
  assert.equal(store.isEnabled, true);
});

test('writes a large Blob in bounded base64 chunks and reads it back byte-for-byte', async () => {
  const { store, filesystem } = createStore();
  const bytes = Uint8Array.from({ length: 700_123 }, (_, index) => (index * 37) % 256);
  const blob = new Blob([bytes], { type: 'model/gltf-binary' });
  const reference = await store.writeBlob(blob, 'character-library/3d', 'actor.glb');
  assert.equal(reference.size, blob.size);
  assert.equal(reference.storage, 'app-files');
  assert.ok(reference.path.startsWith('Animationer/character-library/3d/'));
  assert.ok(filesystem.appendCalls >= 2);
  const restored = await store.readBlob(reference, blob.type);
  assert.deepEqual(new Uint8Array(await restored.arrayBuffer()), bytes);
  assert.equal(restored.type, blob.type);
});

test('stores and reads JSON manifests through the app-private filesystem', async () => {
  const { store } = createStore();
  const ref = await store.writeJson('projects/example', 'project.json', { name: 'Stage', actors: [] });
  assert.deepEqual(await store.readJson(ref.path), { name: 'Stage', actors: [] });
});

test('rejects traversal paths and reports missing files instead of returning empty data', async () => {
  const { store } = createStore();
  await assert.rejects(() => store.writeBlob(new Blob(['x']), '../outside', 'x.bin'), /güvenli kökün dışında/i);
  await assert.rejects(() => store.readBlob({ storage: 'app-files', path: 'Animationer/projects/absent.glb', size: 1 }), /does not exist|missing|no such file/i);
});

test('converts native no-space errors to a clear recoverable storage message', async () => {
  class FullFilesystem extends MemoryFilesystem {
    async writeFile() { throw new Error('No space left on device'); }
  }
  const { store, filesystem } = createStore(new FullFilesystem());
  await assert.rejects(() => store.writeBlob(new Blob(['x']), 'projects/a', 'scene.bin'), /depolama alanı dolu/i);
  assert.equal(filesystem.files.size, 0);
});

test('keeps browser instances disabled and performs no app-private filesystem access', async () => {
  const { store, filesystem } = createStore();
  const web = new AppPrivateFileStore({ filesystem, directory: 'DATA', native: false, platform: 'web' });
  assert.equal(web.isEnabled, false);
  assert.equal(await web.initialize(), false);
});
