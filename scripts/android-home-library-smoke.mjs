import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const DEVTOOLS_URL = 'http://127.0.0.1:9222';
const APP_ID = 'com.monochrome.threejsstudio';
const APK_PATH = 'android/app/build/outputs/apk/debug/app-debug.apk';
const TMP = '/tmp/animationer-home-library';

function adbText(args) {
  return execFileSync('adb', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 16 * 1024 * 1024 }).trim();
}
function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
async function waitForWebViewAndForward(timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const sockets = adbText(['shell', 'cat', '/proc/net/unix']);
    const match = sockets.match(/@?(webview_devtools_remote_[^\s]+)/);
    if (match) {
      adbText(['forward', 'tcp:9222', `localabstract:${match[1].replace(/^@/, '')}`]);
      console.log(`Android WebView socket: ${match[1]}`);
      return;
    }
    await sleep(1000);
  }
  throw new Error('Android WebView debugging socket did not appear.');
}
async function waitForPageTarget(timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${DEVTOOLS_URL}/json/list`);
      if (response.ok) {
        const targets = await response.json();
        const page = targets.find((target) => target.type === 'page' && target.webSocketDebuggerUrl);
        if (page) return page;
      }
    } catch {}
    await sleep(1000);
  }
  throw new Error('Android WebView DevTools page target did not appear.');
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
    if (message.error) handlers.reject(new Error(message.error.message)); else handlers.resolve(message);
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
            const commandTimer = setTimeout(() => { pending.delete(id); commandReject(new Error(`DevTools command timed out: ${method}`)); }, 20_000);
            pending.set(id, { resolve: commandResolve, reject: commandReject, timer: commandTimer });
            socket.send(JSON.stringify({ id, method, params }));
          });
        },
      });
    });
    socket.addEventListener('error', () => { clearTimeout(timer); reject(new Error('Could not connect to Android WebView DevTools.')); });
  });
}
async function evaluate(command, expression) {
  const response = await command('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true });
  if (response.result?.exceptionDetails) throw new Error(response.result.exceptionDetails.exception?.description || response.result.exceptionDetails.text || 'WebView evaluation failed.');
  return response.result?.result?.value;
}
async function waitUntil(command, expression, description, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    last = await evaluate(command, expression);
    if (last) return last;
    await sleep(250);
  }
  const libraryError = await evaluate(command, `document.querySelector('#home-library-error')?.textContent.trim() || ''`).catch(() => '');
  const toast = await evaluate(command, `document.querySelector('#home-toast')?.textContent.trim() || ''`).catch(() => '');
  throw new Error(`Timed out waiting for ${description}; last value=${JSON.stringify(last)}; libraryError=${JSON.stringify(libraryError)}; toast=${JSON.stringify(toast)}`);
}
async function tapSelector(command, selector) {
  const element = await evaluate(command, `(() => {
    const target = document.querySelector(${JSON.stringify(selector)});
    if (!target) return null;
    target.scrollIntoView({ block: 'center' });
    const rect = target.getBoundingClientRect();
    const style = getComputedStyle(target);
    const x = rect.left + rect.width / 2, y = rect.top + rect.height / 2;
    const hit = document.elementFromPoint(x, y);
    const receivesTouch = hit === target || target.contains(hit);
    return { x, y, visible: rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none' && style.pointerEvents !== 'none', receivesTouch, coveredBy: receivesTouch ? null : [hit?.tagName || 'none', hit?.id || '', typeof hit?.className === 'string' ? hit.className : ''].join('#') };
  })()`);
  assert(element?.visible, `Touch target is not visible: ${selector}`);
  assert(element.receivesTouch, `Touch target is covered by ${element.coveredBy}: ${selector}`);
  const point = { x: Math.round(element.x), y: Math.round(element.y), id: 0, radiusX: 1, radiusY: 1, force: 1 };
  await command('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] });
  await command('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await sleep(250);
}
async function setInput(command, selector, value) {
  await evaluate(command, `(() => { const el=document.querySelector(${JSON.stringify(selector)}); if(!el) throw new Error('Missing input ${selector}'); const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set; setter.call(el,${JSON.stringify(value)}); el.dispatchEvent(new Event('input',{bubbles:true})); el.dispatchEvent(new Event('change',{bubbles:true})); return true; })()`);
}
async function setSelect(command, selector, value) {
  await evaluate(command, `(() => { const el=document.querySelector(${JSON.stringify(selector)}); if(!el) throw new Error('Missing select ${selector}'); el.value=${JSON.stringify(value)}; el.dispatchEvent(new Event('change',{bubbles:true})); return true; })()`);
}
async function setFile(command, selector, path) {
  await command('DOM.enable');
  const { result: { root } } = await command('DOM.getDocument', { depth: -1 });
  const { result } = await command('DOM.querySelector', { nodeId: root.nodeId, selector });
  assert(result.nodeId, `Missing file input ${selector}`);
  await command('DOM.setFileInputFiles', { nodeId: result.nodeId, files: [path] });
  await evaluate(command, `document.querySelector(${JSON.stringify(selector)}).dispatchEvent(new Event('change',{bubbles:true}))`);
}
async function projectCount(command) {
  return evaluate(command, `document.querySelectorAll('#home-project-list [data-project-id]').length`);
}
async function waitHome(command) {
  await waitUntil(command, `Boolean(window.animationerHome && !document.querySelector('#home-screen')?.hidden)`, 'project home screen');
  await waitUntil(command, `window.animationerHome?.projects !== undefined`, 'project list initialization');
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function pngChunk(type, data) {
  const name = Buffer.from(type);
  const content = Buffer.concat([name, data]);
  const length = Buffer.alloc(4); length.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(content));
  return Buffer.concat([length, content, crc]);
}
function makePng(width, height) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6;
  const rows = [];
  for (let y = 0; y < height; y++) {
    const row = Buffer.alloc(1 + width * 4); row[0] = 0;
    for (let x = 0; x < width; x++) {
      const p = 1 + x * 4; row[p] = x % 2 ? 235 : 40; row[p + 1] = y % 2 ? 210 : 70; row[p + 2] = 160; row[p + 3] = 255;
    }
    rows.push(row);
  }
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), pngChunk('IHDR', ihdr), pngChunk('IDAT', deflateSync(Buffer.concat(rows))), pngChunk('IEND', Buffer.alloc(0))]);
}
function makeGlb() {
  const json = Buffer.from(JSON.stringify({
    asset: { version: '2.0', generator: 'Animationer Android home/library test' }, scene: 0,
    scenes: [{ nodes: [0] }], nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, mode: 4 }] }],
    buffers: [{ byteLength: 36 }], bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 36, target: 34962 }],
    accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min: [0,0,0], max: [1,1,1] }],
  }));
  const jsonPadded = Buffer.concat([json, Buffer.alloc((4 - (json.length % 4)) % 4, 0x20)]);
  const positions = Buffer.alloc(36);
  [0,0,0, 1,0,0, 0,1,0].forEach((v, i) => positions.writeFloatLE(v, i * 4));
  const total = 12 + 8 + jsonPadded.length + 8 + positions.length;
  const header = Buffer.alloc(12); header.writeUInt32LE(0x46546c67, 0); header.writeUInt32LE(2, 4); header.writeUInt32LE(total, 8);
  const jsonHeader = Buffer.alloc(8); jsonHeader.writeUInt32LE(jsonPadded.length, 0); jsonHeader.writeUInt32LE(0x4e4f534a, 4);
  const binHeader = Buffer.alloc(8); binHeader.writeUInt32LE(positions.length, 0); binHeader.writeUInt32LE(0x004e4942, 4);
  return Buffer.concat([header, jsonHeader, jsonPadded, binHeader, positions]);
}

async function main() {
  execFileSync('mkdir', ['-p', TMP]);
  const invalidPng = `${TMP}/invalid-size.png`, spritePng = `${TMP}/pixel-walker.png`, brokenGlb = `${TMP}/broken.glb`, modelGlb = `${TMP}/triangle-pilot.glb`;
  writeFileSync(invalidPng, makePng(5, 3));
  writeFileSync(spritePng, makePng(4, 2));
  writeFileSync(brokenGlb, Buffer.from('not a glb'));
  writeFileSync(modelGlb, makeGlb());

  console.log('Installing and launching the app on Android API 35.');
  console.log(adbText(['install', '-r', APK_PATH]));
  adbText(['shell', 'am', 'force-stop', APP_ID]);
  const activity = adbText(['shell', 'am', 'start', '-W', '-n', `${APP_ID}/.MainActivity`]);
  console.log(activity);
  assert(activity.includes('Status: ok'), 'Android MainActivity did not start successfully.');

  await waitForWebViewAndForward();
  const target = await waitForPageTarget();
  const devtools = await connectDevTools(target.webSocketDebuggerUrl);
  const command = devtools.command;
  globalThis.__devtoolsCommand = command;
  await command('Runtime.enable');
  await command('Page.enable');
  await waitHome(command);
  adbText(['shell', 'settings', 'put', 'system', 'accelerometer_rotation', '0']);
  adbText(['shell', 'settings', 'put', 'system', 'user_rotation', '0']);
  await waitUntil(command, `window.innerWidth < window.innerHeight`, 'portrait orientation', 15_000);
  assert.equal(await projectCount(command), 0, 'fresh emulator starts with an empty project shelf');
  console.log('PASS: fresh Project Home is visible and starts empty in portrait.');

  await tapSelector(command, '.home-library-tab[data-library-kind="2d"]');
  await setInput(command, '#home-sprite-columns', '2');
  await setInput(command, '#home-sprite-rows', '2');
  await setFile(command, '#home-sprite-picker', invalidPng);
  await waitUntil(command, `Boolean(document.querySelector('#home-library-error')?.textContent.trim())`, 'invalid spritesheet validation');
  assert.equal(await evaluate(command, `document.querySelectorAll('#home-character-list [data-character-id]').length`), 0, 'invalid sprite is not saved to library');
  console.log('PASS: invalid spritesheet dimensions are rejected without creating a library entry.');

  await setInput(command, '#home-sprite-rows', '1');
  await setFile(command, '#home-sprite-picker', spritePng);
  await waitUntil(command, `document.querySelectorAll('#home-character-list [data-character-id]').length === 1`, 'valid 2D sprite upload');
  const spriteId = await evaluate(command, `document.querySelector('#home-character-list [data-character-id]')?.dataset.characterId`);
  await tapSelector(command, `#home-character-list [data-character-id="${spriteId}"] .home-character-card`);
  await waitUntil(command, `Boolean(document.querySelector('#home-character-image')?.complete && document.querySelector('#home-character-image')?.naturalWidth === 4)`, '2D spritesheet preview');
  console.log('PASS: 2D spritesheet uploads and previews with expected source dimensions.');

  await tapSelector(command, '.home-library-tab[data-library-kind="3d"]');
  await setFile(command, '#home-model-picker', brokenGlb);
  await waitUntil(command, `Boolean(document.querySelector('#home-library-error')?.textContent.trim())`, 'invalid GLB validation');
  assert.equal(await evaluate(command, `document.querySelectorAll('#home-character-list [data-character-id]').length`), 0, 'invalid GLB is not saved to library');
  await setFile(command, '#home-model-picker', modelGlb);
  await waitUntil(command, `document.querySelectorAll('#home-character-list [data-character-id]').length === 1`, 'valid GLB upload');
  const modelId = await evaluate(command, `document.querySelector('#home-character-list [data-character-id]')?.dataset.characterId`);
  await tapSelector(command, `#home-character-list [data-character-id="${modelId}"] .home-character-card`);
  await waitUntil(command, `Boolean(!document.querySelector('#home-character-canvas')?.hidden && window.animationerHome?.previewRenderer)`, '3D model preview renderer');
  assert.match(await evaluate(command, `document.querySelector('#home-preview-detail')?.textContent || ''`), /GLB/i);
  console.log('PASS: malformed GLB is rejected; valid GLB uploads and opens a rendered 3D preview.');

  await command('Page.reload', { ignoreCache: true });
  await waitHome(command);
  await waitUntil(command, `document.querySelectorAll('#home-character-list [data-character-id]').length === 1`, '3D library persistence after app reload');
  await tapSelector(command, '.home-library-tab[data-library-kind="2d"]');
  await waitUntil(command, `document.querySelector('#home-character-list [data-character-id]')?.dataset.characterId === ${JSON.stringify(spriteId)}`, '2D library persistence after app reload');
  const restoredSpriteId = await evaluate(command, `document.querySelector('#home-character-list [data-character-id]')?.dataset.characterId`);
  assert.equal(restoredSpriteId, spriteId, '2D asset ID survives application reload');
  await tapSelector(command, '.home-library-tab[data-library-kind="3d"]');
  const restoredModelId = await evaluate(command, `document.querySelector('#home-character-list [data-character-id]')?.dataset.characterId`);
  assert.equal(restoredModelId, modelId, '3D asset ID survives application reload');
  console.log('PASS: both library entries survive a real WebView reload with stable IDs.');

  await tapSelector(command, '#home-create-project');
  await waitUntil(command, `document.querySelector('#home-dialog')?.open`, 'new-project dialog');
  await setInput(command, '#home-dialog-name', 'Android Library QA A');
  await tapSelector(command, '#home-dialog-submit');
  await waitUntil(command, `document.querySelector('#home-screen')?.hidden && window.animationerApp`, 'new project opened in studio');
  const portraitReturnVisible = await evaluate(command, `(() => { const el=document.querySelector('#btn-home-screen'); if(!el) return false; const r=el.getBoundingClientRect(); return getComputedStyle(el).display !== 'none' && r.width > 0 && r.height > 0; })()`);
  if (!portraitReturnVisible) console.log('OBSERVATION: studio return-to-home control is hidden in portrait mode.');
  adbText(['shell', 'settings', 'put', 'system', 'user_rotation', '1']);
  await waitUntil(command, `window.innerWidth > window.innerHeight`, 'landscape orientation', 15_000);
  await waitUntil(command, `document.querySelector('#btn-home-screen') && getComputedStyle(document.querySelector('#btn-home-screen')).display !== 'none'`, 'visible studio return-to-home button');
  console.log(`PASS: project creation opens the studio; portrait return control visible=${portraitReturnVisible}; landscape return control is accessible.`);

  await tapSelector(command, '#btn-home-screen');
  await waitHome(command);
  assert.equal(await projectCount(command), 1, 'created project appears on shelf');
  const firstProjectId = await evaluate(command, `document.querySelector('#home-project-list [data-project-id]')?.dataset.projectId`);
  await tapSelector(command, `#home-project-list [data-project-id="${firstProjectId}"] [data-action="rename"]`);
  await waitUntil(command, `document.querySelector('#home-dialog')?.open`, 'rename project dialog');
  await setInput(command, '#home-dialog-name', 'Android Library QA Renamed');
  await tapSelector(command, '#home-dialog-submit');
  await waitUntil(command, `document.querySelector('#home-project-list [data-project-id="${firstProjectId}"] h3')?.textContent.trim() === 'Android Library QA Renamed'`, 'project rename');
  console.log('PASS: project rename persists in the shelf.');

  await tapSelector(command, `#home-project-list [data-project-id="${firstProjectId}"] [data-action="duplicate"]`);
  await waitUntil(command, `document.querySelector('#home-dialog')?.open`, 'duplicate project dialog');
  await tapSelector(command, '#home-dialog-submit');
  await waitUntil(command, `document.querySelectorAll('#home-project-list [data-project-id]').length === 2`, 'project duplication');
  const secondProjectId = await evaluate(command, `Array.from(document.querySelectorAll('#home-project-list [data-project-id]')).find(el => el.dataset.projectId !== ${JSON.stringify(firstProjectId)})?.dataset.projectId`);
  assert(secondProjectId, 'duplicate project has a distinct project ID');
  console.log('PASS: project duplication creates a second independently identified entry.');

  // Open first project with a 2D library asset and verify it is instantiated in the studio.
  await tapSelector(command, '.home-library-tab[data-library-kind="2d"]');
  await waitUntil(command, `document.querySelector('#home-character-list [data-character-id]')?.dataset.characterId === ${JSON.stringify(spriteId)}`, '2D library available for handoff');
  await tapSelector(command, `#home-character-list [data-character-id="${spriteId}"] .home-character-use`);
  await waitUntil(command, `document.querySelector('#home-dialog')?.open`, '2D Add to Project selector');
  const targetOptions = await evaluate(command, `Array.from(document.querySelectorAll('#home-dialog-target option')).map(option => ({ value: option.value, text: option.textContent.trim() }))`);
  assert.equal(targetOptions.length, 2, 'Add to Project lists both available projects');
  await setSelect(command, '#home-dialog-target', firstProjectId);
  await tapSelector(command, '#home-dialog-submit');
  await waitUntil(command, `window.animationerApp?.worldSpriteCharacterManager?.listActors?.().length === 1`, '2D character appears in target studio project', 30_000);
  console.log('PASS: Add to Project lists targets and spawns the selected 2D character in studio.');

  await tapSelector(command, '#btn-home-screen');
  await waitHome(command);
  await tapSelector(command, '.home-library-tab[data-library-kind="3d"]');
  await waitUntil(command, `document.querySelector('#home-character-list [data-character-id]')?.dataset.characterId === ${JSON.stringify(modelId)}`, '3D library available for handoff');
  await tapSelector(command, `#home-character-list [data-character-id="${modelId}"] .home-character-use`);
  await waitUntil(command, `document.querySelector('#home-dialog')?.open`, '3D Add to Project selector');
  await setSelect(command, '#home-dialog-target', secondProjectId);
  await tapSelector(command, '#home-dialog-submit');
  await waitUntil(command, `window.animationerApp?.character?.actors?.some(actor => actor.modelId === ${JSON.stringify(modelId)})`, '3D GLB appears in target studio project', 30_000);
  console.log('PASS: Add to Project loads the selected 3D library model into a different target project.');

  await tapSelector(command, '#btn-home-screen');
  await waitHome(command);
  await tapSelector(command, `#home-project-list [data-project-id="${secondProjectId}"] [data-action="delete"]`);
  await waitUntil(command, `document.querySelector('#home-dialog')?.open`, 'delete project confirmation');
  await tapSelector(command, '#home-dialog-submit');
  await waitUntil(command, `document.querySelectorAll('#home-project-list [data-project-id]').length === 1`, 'project deletion');
  assert.equal(await evaluate(command, `document.querySelector('#home-project-list [data-project-id]')?.dataset.projectId`), firstProjectId, 'delete removes only the selected duplicate and preserves original');
  console.log('PASS: deleting a duplicated project leaves the original project intact.');

  const finalState = await evaluate(command, `JSON.stringify({ width: innerWidth, height: innerHeight, projects: document.querySelectorAll('#home-project-list [data-project-id]').length, library2d: window.animationerHome?.templates?.length ?? 0, library3d: window.animationerHome?.models?.length ?? 0, portraitReturnVisible: ${portraitReturnVisible} })`);
  console.log(`ANDROID_HOME_LIBRARY_RESULT ${finalState}`);
  console.log('RESULT: all Android Project Home and Character Library deep-flow checks passed.');
  devtools.socket.close();
}

main().catch((error) => {
  console.error('ANDROID_HOME_LIBRARY_FAILURE', error?.stack || error);
  try { globalThis.__devtoolsCommand?.('Runtime.evaluate', { expression: `console.log('test-failure-toast', document.querySelector('#home-toast')?.textContent || '')` }); } catch {}
  process.exitCode = 1;
});
