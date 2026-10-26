import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

const APP_ID = 'com.monochrome.threejsstudio';
const APK_PATH = 'android/app/build/outputs/apk/debug/app-debug.apk';
const DEVTOOLS_URL = 'http://127.0.0.1:9222';

function adb(args) {
  return execFileSync('adb', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForWebView(timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (adb(['shell', 'cat', '/proc/net/unix']).match(/@?(webview_devtools_remote_[^\s]+)/)) return;
    await sleep(500);
  }
  throw new Error('Android WebView debugging socket was not created.');
}

async function waitForPage(timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const response = await fetch(`${DEVTOOLS_URL}/json/list`).catch(() => null);
    if (response?.ok) {
      const page = (await response.json()).find((item) => item.type === 'page' && item.webSocketDebuggerUrl);
      if (page) return page;
    }
    await sleep(500);
  }
  throw new Error('Android app WebView DevTools page was not found.');
}

function connect(url) {
  const socket = new WebSocket(url);
  const pending = new Map();
  let id = 0;
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (!message.id || !pending.has(message.id)) return;
    const waiter = pending.get(message.id);
    pending.delete(message.id);
    clearTimeout(waiter.timer);
    if (message.error) waiter.reject(new Error(message.error.message));
    else waiter.resolve(message);
  });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Timed out connecting to WebView DevTools.')), 10_000);
    socket.addEventListener('open', () => {
      clearTimeout(timer);
      resolve({
        socket,
        command(method, params = {}) {
          const requestId = ++id;
          return new Promise((commandResolve, commandReject) => {
            const commandTimer = setTimeout(() => {
              pending.delete(requestId);
              commandReject(new Error(`DevTools command timed out: ${method}`));
            }, 20_000);
            pending.set(requestId, { resolve: commandResolve, reject: commandReject, timer: commandTimer });
            socket.send(JSON.stringify({ id: requestId, method, params }));
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
  if (response.result?.exceptionDetails) {
    throw new Error(response.result.result?.description || response.result.exceptionDetails.text || 'WebView evaluation failed.');
  }
  return response.result?.result?.value;
}

async function main() {
  console.log('Installing and launching Animationer on Android API 35.');
  console.log(adb(['install', '-r', APK_PATH]));
  adb(['shell', 'am', 'force-stop', APP_ID]);
  const launch = adb(['shell', 'am', 'start', '-W', '-n', `${APP_ID}/.MainActivity`]);
  assert(launch.includes('Status: ok'), `Android activity failed to start: ${launch}`);
  await waitForWebView();
  const socketName = adb(['shell', 'cat', '/proc/net/unix']).match(/@?(webview_devtools_remote_[^\s]+)/)?.[1]?.replace(/^@/, '');
  assert(socketName, 'WebView debugging socket disappeared.');
  adb(['forward', 'tcp:9222', `localabstract:${socketName}`]);
  const page = await waitForPage();
  const devtools = await connect(page.webSocketDebuggerUrl);

  try {
    const result = await evaluate(devtools.command, `(async () => {
      const home = window.animationerHome;
      if (!home || document.getElementById('home-screen')?.hidden) throw new Error('Home Screen was not the initial app view.');
      const store = home.store;
      await store.ready;
      const id = 'android-smoke-' + Date.now();
      const original = new Uint8Array([0, 17, 34, 51, 68, 85, 102, 119, 136, 153, 170, 187]);
      const blob = new Blob([original], { type: 'image/png' });
      await store.saveCharacterTemplate({ id, name: 'Android Storage Smoke', blob, mimeType: blob.type, fileName: 'smoke.png', columns: 1, rows: 1, fps: 12 });
      await home.refresh();
      const metadata = (await store.listCharacterTemplateMetadata()).find((item) => item.id === id);
      const rawCharacter = await store._get('character-library', id, 'smoke test metadata read failed');
      const loadedCharacter = await store.getCharacterTemplate(id);
      const loadedBytes = new Uint8Array(await loadedCharacter.blob.arrayBuffer());
      const project = await store.createProject('Android Storage Smoke');
      const pointer = await store._get('projects', 'project:' + project.projectId, 'smoke test manifest pointer read failed');
      const loadedProject = await store.loadProject(project.projectId);
      const listedProjects = await store.listProjects();
      return {
        nativeStorage: store.fileStore.isEnabled,
        homeVisible: !document.getElementById('home-screen').hidden,
        libraryCardVisible: Boolean(document.querySelector('[data-character-id="' + id + '"]')),
        metadataOnly: Boolean(metadata && !Object.hasOwn(metadata, 'blob')),
        characterReference: rawCharacter?.fileRef?.path || null,
        characterRoundTrip: loadedBytes.length === original.length && loadedBytes.every((byte, index) => byte === original[index]),
        projectListed: listedProjects.some((item) => item.id === project.projectId && item.name === 'Android Storage Smoke'),
        manifestPath: pointer?.manifestPath || null,
        projectRoundTrip: loadedProject?.projectId === project.projectId && loadedProject?.name === project.name,
      };
    })()`);

    assert.equal(result.nativeStorage, true, `App-private Android storage was not enabled: ${JSON.stringify(result)}`);
    assert.equal(result.homeVisible, true, 'Home Screen was not visible at startup.');
    assert.equal(result.libraryCardVisible, true, 'Saved character did not appear in Home Screen library.');
    assert.equal(result.metadataOnly, true, 'Character metadata listing unexpectedly included a Blob.');
    assert.match(result.characterReference || '', /^Animationer\/character-library\/2d\//);
    assert.equal(result.characterRoundTrip, true, '2D character file did not round-trip byte-for-byte.');
    assert.match(result.manifestPath || '', /^Animationer\/projects\//);
    assert.equal(result.projectListed, true, 'Created project did not appear in Home Screen project list.');
    assert.equal(result.projectRoundTrip, true, 'Project manifest did not load back from app-private storage.');
    console.log('PASS: Android Home Screen, 2D metadata-only library, verified file-backed character round-trip, and project manifest persistence.');
    console.log(JSON.stringify(result, null, 2));
  } finally {
    devtools.socket.close();
    adb(['forward', '--remove', 'tcp:9222']);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
