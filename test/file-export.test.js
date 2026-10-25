import test from 'node:test';
import assert from 'node:assert/strict';
import { saveGeneratedFile, saveToCapacitorDocuments } from '../src/utils/FileExportManager.js';

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
    assert.equal(result.saved, true);
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
