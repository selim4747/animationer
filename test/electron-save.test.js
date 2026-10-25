import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { saveGeneratedFileFromRenderer } from '../electron/save-generated-file.js';
import { ElectronChunkedSaveSessions } from '../electron/save-generated-file-stream.js';

const makeWindow = () => ({ webContents: {} });

test('Electron save handler writes binary bytes to the path chosen in Save As', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'animationer-save-'));
  const target = path.join(directory, 'capture.png');
  const window = makeWindow();
  let dialogOptions;

  try {
    const result = await saveGeneratedFileFromRenderer(
      { sender: window.webContents },
      { filename: 'scene.png', data: new Uint8Array([0, 1, 127, 128, 255]) },
      window,
      {
        dialogApi: {
          async showSaveDialog(parent, options) {
            assert.equal(parent, window);
            dialogOptions = options;
            return { canceled: false, filePath: target };
          },
        },
      },
    );

    assert.deepEqual(result, { saved: true, filename: 'capture.png', path: target });
    assert.deepEqual(await readFile(target), Buffer.from([0, 1, 127, 128, 255]));
    assert.equal(dialogOptions.defaultPath, 'scene.png');
    assert.deepEqual(dialogOptions.filters[0].extensions, ['png']);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('Electron save handler treats Save As cancellation as a non-error result', async () => {
  const window = makeWindow();
  let writes = 0;
  const result = await saveGeneratedFileFromRenderer(
    { sender: window.webContents },
    { filename: 'clip.webm', data: new ArrayBuffer(4) },
    window,
    {
      dialogApi: { async showSaveDialog() { return { canceled: true }; } },
      async writeFileImpl() { writes += 1; },
    },
  );

  assert.deepEqual(result, { saved: false, canceled: true });
  assert.equal(writes, 0);
});

test('Electron save handler rejects unrelated renderer senders and unsupported extensions', async () => {
  const window = makeWindow();
  const dialogApi = { async showSaveDialog() { throw new Error('Must not open a dialog.'); } };

  await assert.rejects(
    saveGeneratedFileFromRenderer({ sender: {} }, { filename: 'capture.png', data: new ArrayBuffer(1) }, window, { dialogApi }),
    /uygulama penceresinden/i,
  );
  await assert.rejects(
    saveGeneratedFileFromRenderer({ sender: window.webContents }, { filename: 'payload.exe', data: new ArrayBuffer(1) }, window, { dialogApi }),
    /dosya türü/i,
  );
});

test('chunked Electron save writes bounded binary chunks and publishes the file only at finish', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'animationer-stream-'));
  const target = path.join(directory, 'capture.webm');
  const window = makeWindow();
  const event = { sender: window.webContents };
  const sessions = new ElectronChunkedSaveSessions({ idFactory: () => 'test-session' });
  try {
    const started = await sessions.begin(event, { filename: 'capture.webm', size: 5 }, window, {
      async showSaveDialog() { return { canceled: false, filePath: target }; },
    });
    assert.equal(started.sessionId, 'test-session');
    await sessions.write(event, started.sessionId, new Uint8Array([0, 1]), window);
    await sessions.write(event, started.sessionId, new Uint8Array([127, 128, 255]), window);
    await assert.rejects(readFile(target), { code: 'ENOENT' });

    const result = await sessions.finish(event, started.sessionId, window);
    assert.deepEqual(result, { saved: true, filename: 'capture.webm', path: target });
    assert.deepEqual(await readFile(target), Buffer.from([0, 1, 127, 128, 255]));
    assert.equal(sessions.sessions.size, 0);
  } finally {
    await sessions.abortAll();
    await rm(directory, { recursive: true, force: true });
  }
});

test('chunked Electron save rejects unowned sessions and removes aborted temporary files', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'animationer-stream-abort-'));
  const target = path.join(directory, 'capture.mp4');
  const window = makeWindow();
  const event = { sender: window.webContents };
  const sessions = new ElectronChunkedSaveSessions({ idFactory: () => 'abort-session' });
  try {
    const started = await sessions.begin(event, { filename: 'capture.mp4', size: 4 }, window, {
      async showSaveDialog() { return { canceled: false, filePath: target }; },
    });
    await assert.rejects(sessions.write({ sender: {} }, started.sessionId, new Uint8Array([1]), window), /uygulama penceresinden/i);
    await sessions.write(event, started.sessionId, new Uint8Array([1]), window);
    await assert.rejects(sessions.finish(event, started.sessionId, window), /tamamı ulaşmadı/i);
    await sessions.abort(event, started.sessionId, window);
    assert.equal(sessions.sessions.size, 0);
    assert.deepEqual(await readdir(directory), []);
  } finally {
    await sessions.abortAll();
    await rm(directory, { recursive: true, force: true });
  }
});
