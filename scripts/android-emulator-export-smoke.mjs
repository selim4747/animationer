import { execFileSync } from 'node:child_process';

const DEVTOOLS_URL = 'http://127.0.0.1:9222';
const EXPORT_DIRECTORY = '/sdcard/Documents/Animationer';
const APP_ID = 'com.monochrome.threejsstudio';

function adb(args, options = {}) {
  return execFileSync('adb', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    ...options,
  }).trim();
}

async function waitForPageTarget(timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${DEVTOOLS_URL}/json/list`);
      if (response.ok) {
        const targets = await response.json();
        const page = targets.find((target) => target.type === 'page' && target.webSocketDebuggerUrl);
        if (page) return page;
      }
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error(`Android WebView DevTools target was not available: ${lastError?.message || 'timeout'}`);
}

function connectDevTools(url) {
  const socket = new WebSocket(url);
  const pending = new Map();
  let nextId = 0;

  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (!message.id) return;
    const handlers = pending.get(message.id);
    if (!handlers) return;
    pending.delete(message.id);
    clearTimeout(handlers.timer);
    if (message.error) handlers.reject(new Error(message.error.message));
    else handlers.resolve(message);
  });

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Timed out connecting to Android WebView DevTools.')), 15_000);
    socket.addEventListener('open', () => {
      clearTimeout(timer);
      resolve({
        socket,
        command(method, params = {}) {
          const id = ++nextId;
          return new Promise((commandResolve, commandReject) => {
            const commandTimer = setTimeout(() => {
              pending.delete(id);
              commandReject(new Error(`DevTools command timed out: ${method}`));
            }, 15_000);
            pending.set(id, { resolve: commandResolve, reject: commandReject, timer: commandTimer });
            socket.send(JSON.stringify({ id, method, params }));
          });
        },
      });
    });
    socket.addEventListener('error', () => {
      clearTimeout(timer);
      reject(new Error('Could not connect to Android WebView DevTools.'));
    });
  });
}

async function evaluate(command, expression) {
  const response = await command('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
    userGesture: true,
  });
  const result = response.result?.result;
  if (response.result?.exceptionDetails) {
    throw new Error(result?.description || response.result.exceptionDetails.text || 'WebView evaluation failed.');
  }
  return result?.value;
}

function findExportedPng() {
  try {
    const output = adb([
      'shell', 'find', EXPORT_DIRECTORY, '-maxdepth', '1', '-type', 'f', '-name', 'diorama_snapshot_*.png',
    ]);
    return output.split('\n').filter(Boolean).at(-1) || null;
  } catch {
    return null;
  }
}

async function main() {
  const target = await waitForPageTarget();
  console.log(`Attached to Android WebView page: ${target.url || '(no URL)'}`);
  const devtools = await connectDevTools(target.webSocketDebuggerUrl);

  try {
    const pageState = await evaluate(devtools.command, `(() => {
      const renderTab = document.querySelector('.studio-tab-btn[data-tab="tab-render"]');
      const screenshotButton = document.querySelector('#btn-take-screenshot');
      if (!renderTab || !screenshotButton) {
        throw new Error('Render tab or PNG screenshot button is missing from the app UI.');
      }
      if (!document.querySelector('canvas')) {
        throw new Error('The 3D scene canvas has not been rendered.');
      }
      renderTab.click();
      screenshotButton.click();
      return {
        appTitle: document.title,
        platform: window.Capacitor?.getPlatform?.() || 'unknown',
        canvasWidth: document.querySelector('canvas').width,
        canvasHeight: document.querySelector('canvas').height,
      };
    })()`);
    console.log(`Clicked the in-app PNG export control: ${JSON.stringify(pageState)}`);

    const deadline = Date.now() + 60_000;
    let pngPath = null;
    while (Date.now() < deadline) {
      pngPath = findExportedPng();
      if (pngPath) break;
      await new Promise((resolve) => setTimeout(resolve, 1_000));
    }
    if (!pngPath) {
      const toast = await evaluate(devtools.command, `document.querySelector('#toast')?.textContent || ''`);
      throw new Error(`PNG was not written to ${EXPORT_DIRECTORY}. App toast: ${toast || '(empty)'}`);
    }

    const png = execFileSync('adb', ['exec-out', 'cat', pngPath], { maxBuffer: 64 * 1024 * 1024 });
    const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    if (png.length < 24 || !png.subarray(0, 8).equals(signature)) {
      throw new Error(`Exported file is not a valid PNG: ${pngPath} (${png.length} bytes).`);
    }
    const width = png.readUInt32BE(16);
    const height = png.readUInt32BE(20);
    if (width < 1 || height < 1) throw new Error(`Exported PNG has invalid dimensions: ${width}x${height}.`);

    console.log(`PASS: Android Filesystem wrote ${pngPath} (${png.length} bytes, ${width}x${height}).`);
  } finally {
    devtools.socket.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
