import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { saveGeneratedFileFromRenderer } from '../electron/save-generated-file.js';

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
