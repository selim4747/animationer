import test from 'node:test';
import assert from 'node:assert/strict';
import { LEGACY_ELECTRON_MAX_BYTES, saveGeneratedFile, saveToCapacitorDocuments } from '../src/utils/FileExportManager.js';

test('routes exported files through the Windows Electron save dialog bridge', async () => {
  const originalWindow = globalThis.window;
  let request;
  globalThis.window = {
    dioramaDesktop: {
      async saveGeneratedFile(value) {
        request = value;
        return { saved: true, filename: 'sahne.png', path: 'C:\\Users\\test\\sahne.png' };
      },
    },
  };
  const progress = [];

  try {
    const result = await saveGeneratedFile(new Blob(['png-data'], { type: 'image/png' }), 'scene.png', {
      onProgress: (event) => progress.push(event),
    });
    assert.equal(result.saved, true);
    assert.equal(result.method, 'electron');
    assert.equal(request.filename, 'scene.png');
    assert.equal(Buffer.from(request.data).toString(), 'png-data');
    assert.deepEqual(progress.map((event) => event.stage), ['waiting-for-destination', 'saved']);
    assert.equal(progress.at(-1).percent, 100);
  } finally {
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
  }
});

test('streams large Windows blobs through bounded chunks and reports monotonic progress', async () => {
  const originalWindow = globalThis.window;
  const chunks = [];
  const progress = [];
  globalThis.window = {
    dioramaDesktop: {
      async beginGeneratedFile(request) { assert.equal(request.size, 3 * 1024 * 1024 + 5); return { sessionId: 'stream-1', filename: 'clip.webm' }; },
      async writeGeneratedFileChunk(id, bytes) { assert.equal(id, 'stream-1'); chunks.push(new Uint8Array(bytes)); return { written: chunks.reduce((sum, chunk) => sum + chunk.length, 0) }; },
      async finishGeneratedFile() { return { saved: true, filename: 'clip.webm', path: 'C:\\clip.webm' }; },
      async abortGeneratedFile() { throw new Error('Unexpected abort'); },
      async saveGeneratedFile() { throw new Error('Chunked API should be selected'); },
    },
  };
  try {
    const bytes = Buffer.alloc((3 * 1024 * 1024) + 5, 0x5a);
    const result = await saveGeneratedFile(new Blob([bytes]), 'clip.webm', { onProgress: (event) => progress.push(event) });
    assert.equal(result.saved, true);
    assert.equal(result.method, 'electron');
    assert.deepEqual(Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))), bytes);
    assert(chunks.every((chunk) => chunk.byteLength <= 3 * 1024 * 1024));
    assert.equal(progress.at(-1).percent, 100);
    assert(progress.every((event, index) => index === 0 || event.bytesWritten >= progress[index - 1].bytesWritten));
  } finally {
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
  }
});

test('refuses large files on the legacy Electron bridge before reading the full buffer', async () => {
  const originalWindow = globalThis.window;
  let called = false;
  globalThis.window = { dioramaDesktop: { async saveGeneratedFile() { called = true; return { saved: true }; } } };
  try {
    const blob = new Blob([new Uint8Array(LEGACY_ELECTRON_MAX_BYTES + 1)]);
    await assert.rejects(saveGeneratedFile(blob, 'large.webm'), /eski dışa aktarma köprüsü.*desteklenmiyor/i);
    assert.equal(called, false);
  } finally {
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
  }
});

test('writes binary exports to the Capacitor Documents folder after permission is granted', async () => {
  const calls = [];
  const filesystem = {
    async checkPermissions() { return { publicStorage: 'prompt' }; },
    async requestPermissions() { calls.push(['requestPermissions']); return { publicStorage: 'granted' }; },
    async writeFile(options) { calls.push(['writeFile', options]); },
    async appendFile(options) { calls.push(['appendFile', options]); },
  };
  const bytes = Buffer.from([0, 1, 127, 128, 255]);
  const result = await saveToCapacitorDocuments(new Blob([bytes]), 'capture.png', filesystem, 'DOCUMENTS');

  assert.equal(result.saved, true);
  assert.equal(result.location, 'Documents/Animationer/capture.png');
  assert.deepEqual(calls.map(([name]) => name), ['requestPermissions', 'writeFile']);
  assert.deepEqual(Buffer.from(calls[1][1].data, 'base64'), bytes);
  assert.equal(calls[1][1].directory, 'DOCUMENTS');
  assert.equal(calls[1][1].recursive, true);
});

test('writes large native files in bounded base64 chunks', async () => {
  const calls = [];
  const progress = [];
  const filesystem = {
    async checkPermissions() { return { publicStorage: 'granted' }; },
    async requestPermissions() { throw new Error('Permission prompt should not be repeated.'); },
    async writeFile(options) { calls.push(['writeFile', options]); },
    async appendFile(options) { calls.push(['appendFile', options]); },
  };
  const bytes = Buffer.alloc((3 * 1024 * 1024) + 5, 0x5a);
  await saveToCapacitorDocuments(new Blob([bytes]), 'long-recording.webm', filesystem, 'DOCUMENTS', (event) => progress.push(event));

  assert.deepEqual(calls.map(([name]) => name), ['writeFile', 'appendFile']);
  const reconstructed = Buffer.concat(calls.map(([, options]) => Buffer.from(options.data, 'base64')));
  assert.deepEqual(reconstructed, bytes);
  assert.equal(progress[0].percent, 0);
  assert.equal(progress.at(-1).percent, 100);
  assert(progress.every((event, index) => index === 0 || event.bytesWritten >= progress[index - 1].bytesWritten));
});

test('uses smaller native write chunks on low-memory Android devices', async () => {
  const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { deviceMemory: 2, userAgent: 'Android' } });
  const calls = [];
  const filesystem = {
    async checkPermissions() { return { publicStorage: 'granted' }; },
    async writeFile(options) { calls.push(options); },
    async appendFile(options) { calls.push(options); },
  };
  try {
    const bytes = Buffer.alloc((1024 * 1024) + 7, 0x31);
    await saveToCapacitorDocuments(new Blob([bytes]), 'low-memory.webm', filesystem, 'DOCUMENTS');
    assert.equal(calls.length, 2);
    assert(calls.every((call) => Buffer.from(call.data, 'base64').byteLength <= 1024 * 1024));
    assert.deepEqual(Buffer.concat(calls.map((call) => Buffer.from(call.data, 'base64'))), bytes);
  } finally {
    if (originalNavigator) Object.defineProperty(globalThis, 'navigator', originalNavigator);
    else delete globalThis.navigator;
  }
});

test('does not write to device storage when permission is denied', async () => {
  let wroteFile = false;
  const filesystem = {
    async checkPermissions() { return { publicStorage: 'denied' }; },
    async requestPermissions() { return { publicStorage: 'denied' }; },
    async writeFile() { wroteFile = true; },
    async appendFile() { wroteFile = true; },
  };

  await assert.rejects(
    saveToCapacitorDocuments(new Blob(['image']), 'capture.png', filesystem, 'DOCUMENTS'),
    /depolama izni/i,
  );
  assert.equal(wroteFile, false);
});

test('uses a Blob URL and a browser download link outside native apps', async () => {
  const originalWindow = globalThis.window;
  const originalDocument = globalThis.document;
  const originalCreateObjectURL = URL.createObjectURL;
  const originalRevokeObjectURL = URL.revokeObjectURL;
  const created = [];
  let clicked = false;
  URL.createObjectURL = () => 'blob:test-export';
  URL.revokeObjectURL = (url) => created.push(['revoke', url]);
  globalThis.window = { setTimeout: (callback) => { callback(); return 1; } };
  globalThis.document = {
    body: { appendChild: (link) => created.push(['append', link]) },
    createElement: () => ({
      style: {},
      click() { clicked = true; },
      remove() { created.push(['remove']); },
    }),
  };

  try {
    const result = await saveGeneratedFile(new Blob(['image']), 'capture.png');
    assert.equal(result.saved, false);
    assert.equal(result.initiated, true);
    assert.equal(result.method, 'browser');
    assert.equal(clicked, true);
    assert.equal(created[0][1].href, 'blob:test-export');
    assert.equal(created[0][1].download, 'capture.png');
    assert.deepEqual(created.slice(1), [['remove'], ['revoke', 'blob:test-export']]);
  } finally {
    URL.createObjectURL = originalCreateObjectURL;
    URL.revokeObjectURL = originalRevokeObjectURL;
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
    if (originalDocument === undefined) delete globalThis.document;
    else globalThis.document = originalDocument;
  }
});
