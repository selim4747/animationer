import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

const DEVTOOLS_URL = 'http://127.0.0.1:9222';
const EXPORT_DIRECTORY = '/sdcard/Documents/Animationer';
const APP_ID = 'com.monochrome.threejsstudio';
const APK_PATH = 'android/app/build/outputs/apk/debug/app-debug.apk';
const EXPECTED_TABS = ['tab-timeline', 'tab-scene', 'tab-camera', 'tab-character', 'tab-sprites', 'tab-render'];

function adbText(args) {
  return execFileSync('adb', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 16 * 1024 * 1024,
  }).trim();
}

function readDeviceFile(path) {
  return execFileSync('adb', ['exec-out', 'cat', path], { maxBuffer: 64 * 1024 * 1024 });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForWebViewAndForward(timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const unixSockets = adbText(['shell', 'cat', '/proc/net/unix']);
    const match = unixSockets.match(/@?(webview_devtools_remote_[^\s]+)/);
    if (match) {
      const socketName = match[1].replace(/^@/, '');
      adbText(['forward', 'tcp:9222', `localabstract:${socketName}`]);
      console.log(`Connected to Android WebView debugging socket: ${socketName}`);
      return;
    }
    await sleep(1_000);
  }
  const logs = adbText(['logcat', '-d', '-t', '250']);
  console.error(logs.split('\n').slice(-80).join('\n'));
  throw new Error('Android WebView debugging socket was not created.');
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
    await sleep(1_000);
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

async function tapSelector(command, selector) {
  const element = await evaluate(command, `(() => {
    const target = document.querySelector(${JSON.stringify(selector)});
    if (!target) return null;
    target.scrollIntoView({ block: 'center' });
    const rect = target.getBoundingClientRect();
    const style = getComputedStyle(target);
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    const hit = document.elementFromPoint(x, y);
    const receivesTouch = hit === target || target.contains(hit);
    return {
      x,
      y,
      visible: rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none' && style.pointerEvents !== 'none',
      receivesTouch,
      coveredBy: receivesTouch ? null : [hit?.tagName || 'none', hit?.id || '', typeof hit?.className === 'string' ? hit.className : ''].join('#'),
    };
  })()`);
  assert(element?.visible, `Touch target is not visible: ${selector}`);
  assert(element.receivesTouch, `Touch target is covered by ${element.coveredBy}: ${selector}`);
  const point = { x: Math.round(element.x), y: Math.round(element.y), id: 0, radiusX: 1, radiusY: 1, force: 1 };
  await command('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] });
  await command('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await sleep(250);
}

async function waitForExportedFile(pattern, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const output = adbText([
        'shell', 'find', EXPORT_DIRECTORY, '-maxdepth', '1', '-type', 'f', '-name', pattern,
      ]);
      const path = output.split('\n').filter(Boolean).at(-1);
      if (path) return path;
    } catch {
      // The app creates the Documents subdirectory during its first native save.
    }
    await sleep(1_000);
  }
  const toast = await evaluate(globalThis.__devtoolsCommand, `document.querySelector('#toast')?.textContent || ''`);
  throw new Error(`No ${pattern} file appeared under ${EXPORT_DIRECTORY}. App toast: ${toast || '(empty)'}`);
}

async function waitForAndroidShareSheet(timeoutMs = 12_000) {
  const deadline = Date.now() + timeoutMs;
  let activityDump = '';
  while (Date.now() < deadline) {
    activityDump = adbText(['shell', 'dumpsys', 'activity', 'activities']);
    const resumed = activityDump.split('\n')
      .filter((line) => /mResumedActivity|topResumedActivity|mFocusedActivity/i.test(line))
      .join('\n');
    if (/ChooserActivity|ResolverActivity|com\.android\.intentresolver/i.test(resumed)) return resumed;
    await sleep(500);
  }
  return activityDump;
}

async function waitForShareAction(command, timeoutMs = 12_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const visible = await evaluate(command, `(() => {
      const button = document.querySelector('#toast-action');
      return Boolean(button && !button.hidden && button.textContent.trim());
    })()`);
    if (visible) return true;
    await sleep(250);
  }
  return false;
}

async function waitForVideoPreview(command, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  let state;
  while (Date.now() < deadline) {
    state = await evaluate(command, `(() => {
      const video = document.querySelector('#recording-video-preview');
      return {
        hidden: document.querySelector('#recording-preview-panel')?.hidden,
        readyState: video?.readyState ?? 0,
        duration: Number.isFinite(video?.duration) ? video.duration : null,
        durationIsInfinite: video?.duration === Infinity,
        width: video?.videoWidth ?? 0,
        height: video?.videoHeight ?? 0,
        error: video?.error?.message || null,
      };
    })()`);
    if (state.error) throw new Error(`Android video preview decode error: ${state.error}`);
    const hasUsableDuration = state.durationIsInfinite || (Number.isFinite(state.duration) && state.duration > 0);
    if (state.hidden === false && state.readyState >= 2 && state.width > 0 && state.height > 0 && hasUsableDuration) return state;
    await sleep(300);
  }
  throw new Error(`Saved video preview did not become playable: ${JSON.stringify(state)}`);
}

async function main() {
  console.log('Installing and launching the app on Android API 35.');
  console.log(adbText(['install', '-r', APK_PATH]));
  adbText(['shell', 'am', 'force-stop', APP_ID]);
  const activity = adbText(['shell', 'am', 'start', '-W', '-n', `${APP_ID}/.MainActivity`]);
  console.log(activity);
  assert(activity.includes('Status: ok'), 'Android MainActivity did not start successfully.');

  await waitForWebViewAndForward();
  const target = await waitForPageTarget();
  console.log(`Attached to Android app page: ${target.url || '(no URL)'}`);
  const devtools = await connectDevTools(target.webSocketDebuggerUrl);
  globalThis.__devtoolsCommand = devtools.command;

  try {
    const uiDeadline = Date.now() + 120_000;
    let uiState;
    while (Date.now() < uiDeadline) {
      uiState = await evaluate(devtools.command, `(() => ({
        tabs: Array.from(document.querySelectorAll('.studio-tab-btn')).map((button) => button.dataset.tab),
        screenshotButton: !!document.querySelector('#btn-take-screenshot'),
        canvas: !!document.querySelector('canvas'),
        appTitle: document.title,
        readyState: document.readyState,
        bodyText: document.body?.innerText?.slice(0, 300) || '',
      }))()`);
      if (uiState.tabs?.length === EXPECTED_TABS.length && uiState.screenshotButton && uiState.canvas) break;
      await sleep(1_000);
    }
    assert.deepEqual(uiState?.tabs, EXPECTED_TABS, `Expected all six tabs; got ${JSON.stringify(uiState?.tabs)}`);
    assert(uiState.screenshotButton && uiState.canvas, `App UI did not become ready: ${JSON.stringify(uiState)}`);
    console.log(`PASS: Android app UI loaded (${uiState.appTitle}; ${EXPECTED_TABS.length} tabs; canvas present).`);

    // Exercise every tab with Android touch input and verify the matching panel becomes active.
    for (const tabId of EXPECTED_TABS) {
      await tapSelector(devtools.command, `.studio-tab-btn[data-tab="${tabId}"]`);
      const tabState = await evaluate(devtools.command, `(() => {
        const button = document.querySelector(${JSON.stringify(`.studio-tab-btn[data-tab="${tabId}"]`)});
        const pane = document.getElementById(${JSON.stringify(tabId)});
        return {
          active: button?.classList.contains('active'),
          displayed: pane?.style.display,
          visiblePanes: Array.from(document.querySelectorAll('.studio-tab-pane')).filter((item) => item.style.display !== 'none').map((item) => item.id),
        };
      })()`);
      assert.equal(tabState.active, true, `Tab was not marked active: ${tabId}`);
      assert.equal(tabState.displayed, 'block', `Tab pane was not displayed: ${tabId}`);
      assert.deepEqual(tabState.visiblePanes, [tabId], `Unexpected visible panes after selecting ${tabId}`);
    }
    console.log('PASS: Touch navigation across all six tabs; selected content matched each tab.');

    // Collapse/expand must update both the visual state and accessibility/inert state.
    await tapSelector(devtools.command, '#panel-collapse-trigger');
    const collapsed = await evaluate(devtools.command, `(() => {
      const body = document.querySelector('#panel-body-wrapper');
      const button = document.querySelector('#panel-collapse-trigger');
      return { expanded: button.getAttribute('aria-expanded'), hidden: body.getAttribute('aria-hidden'), inert: body.inert, collapsed: body.classList.contains('collapsed') };
    })()`);
    assert.deepEqual(collapsed, { expanded: 'false', hidden: 'true', inert: true, collapsed: true });
    await tapSelector(devtools.command, '#panel-collapse-trigger');
    const expanded = await evaluate(devtools.command, `(() => {
      const body = document.querySelector('#panel-body-wrapper');
      const button = document.querySelector('#panel-collapse-trigger');
      return { expanded: button.getAttribute('aria-expanded'), hidden: body.getAttribute('aria-hidden'), inert: body.inert, collapsed: body.classList.contains('collapsed') };
    })()`);
    assert.deepEqual(expanded, { expanded: 'true', hidden: 'false', inert: false, collapsed: false });
    console.log('PASS: Panel collapsed and expanded by touch; accessibility and inert state stayed synchronized.');

    // Hiding the panel must leave the floating restore action visible and reachable by touch.
    await tapSelector(devtools.command, '#btn-toggle-hud-vis');
    const hiddenPanel = await evaluate(devtools.command, `(() => {
      const panel = document.querySelector('#studio-panel');
      const button = document.querySelector('#btn-toggle-hud-vis');
      const restore = document.querySelector('#btn-restore-studio-panel');
      const rect = restore.getBoundingClientRect();
      const style = getComputedStyle(restore);
      const inViewport = rect.right > 0 && rect.left < innerWidth && rect.bottom > 0 && rect.top < innerHeight;
      return {
        hidden: panel.classList.contains('hidden-cinematic'),
        pressed: button.getAttribute('aria-pressed'),
        restoreVisible: !restore.hidden,
        touchReachable: inViewport && rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none' && style.pointerEvents !== 'none',
        rect: { top: Math.round(rect.top), bottom: Math.round(rect.bottom), viewportHeight: innerHeight },
      };
    })()`);
    assert.equal(hiddenPanel.hidden, true, 'Full-screen control did not hide the panel.');
    assert.equal(hiddenPanel.pressed, 'true');
    assert.equal(hiddenPanel.restoreVisible, true, 'Floating panel restore action was hidden.');
    assert.equal(hiddenPanel.touchReachable, true, `Floating restore action is outside the touch viewport: ${JSON.stringify(hiddenPanel.rect)}`);
    await tapSelector(devtools.command, '#btn-restore-studio-panel');
    const restoredPanel = await evaluate(devtools.command, `(() => ({
      hidden: document.querySelector('#studio-panel').classList.contains('hidden-cinematic'),
      pressed: document.querySelector('#btn-toggle-hud-vis').getAttribute('aria-pressed'),
      restoreHidden: document.querySelector('#btn-restore-studio-panel').hidden,
    }))()`);
    assert.deepEqual(restoredPanel, { hidden: false, pressed: 'false', restoreHidden: true });
    console.log('PASS: Full-screen mode toggled and the floating restore button reopened the controls by touch.');

    // Add a safe sample action, then export and validate the actual device JSON file.
    await tapSelector(devtools.command, '.studio-tab-btn[data-tab="tab-timeline"]');
    const stepCountBefore = await evaluate(devtools.command, `document.querySelector('#timeline-steps-list').children.length`);
    await tapSelector(devtools.command, '#btn-add-wait-step');
    const stepDeadline = Date.now() + 5_000;
    let stepCountAfter = stepCountBefore;
    while (Date.now() < stepDeadline && stepCountAfter === stepCountBefore) {
      await sleep(200);
      stepCountAfter = await evaluate(devtools.command, `document.querySelector('#timeline-steps-list').children.length`);
    }
    assert.equal(stepCountAfter, stepCountBefore + 1, 'Adding the quick wait step did not update the timeline.');
    await tapSelector(devtools.command, '#btn-export-timeline-json');
    const jsonPath = await waitForExportedFile('animationer-project.json');
    const project = JSON.parse(readDeviceFile(jsonPath).toString('utf8'));
    assert.equal(project.format, 'animationer-project');
    assert.equal(project.schemaVersion, 2);
    assert.equal(project.scope?.timeline, true);
    assert(Array.isArray(project.steps));
    assert.equal(project.steps.length, stepCountAfter);
    console.log(`PASS: Timeline accepted a new step and saved valid project JSON (${jsonPath}; ${project.steps.length} steps).`);

    const shareActionVisible = await waitForShareAction(devtools.command);
    assert.equal(shareActionVisible, true, 'Saved Android project did not expose its Share action after the native save finished.');
    await tapSelector(devtools.command, '#toast-action');
    const shareActivityDump = await waitForAndroidShareSheet();
    assert(/ChooserActivity|ResolverActivity|com\.android\.intentresolver/i.test(shareActivityDump), 'Android system Share sheet did not open.');
    console.log('PASS: Saved project Share action opened the Android system Share sheet.');
    adbText(['shell', 'input', 'keyevent', '4']);
    await sleep(500);

    // Save a PNG from the real Render UI and validate bytes and dimensions.
    await tapSelector(devtools.command, '.studio-tab-btn[data-tab="tab-render"]');
    const canvas = await evaluate(devtools.command, `(() => { const c = document.querySelector('canvas'); return { width: c.width, height: c.height }; })()`);
    await tapSelector(devtools.command, '#btn-take-screenshot');
    const pngPath = await waitForExportedFile('diorama_snapshot_*.png');
    const png = readDeviceFile(pngPath);
    const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    assert(png.length >= 24 && png.subarray(0, 8).equals(pngSignature), `Invalid PNG file: ${pngPath}`);
    const pngWidth = png.readUInt32BE(16);
    const pngHeight = png.readUInt32BE(20);
    assert(pngWidth > 0 && pngHeight > 0);
    assert.equal(pngWidth, canvas.width);
    assert.equal(pngHeight, canvas.height);
    console.log(`PASS: PNG saved to Android Documents (${pngPath}; ${png.length} bytes; ${pngWidth}x${pngHeight}).`);

    // Record and stop a short real MediaRecorder capture; verify the saved container header.
    await tapSelector(devtools.command, '#btn-toggle-video-record');
    const recordingState = await evaluate(devtools.command, `(() => {
      const button = document.querySelector('#btn-toggle-video-record');
      return { active: button.classList.contains('recording-active'), label: button.textContent.trim(), banner: document.querySelector('#render-recording-banner').style.display };
    })()`);
    assert.equal(recordingState.active, true, `Manual video recording failed to start: ${JSON.stringify(recordingState)}`);
    await sleep(2_500);
    await tapSelector(devtools.command, '#btn-toggle-video-record');
    let videoPath;
    try {
      videoPath = await waitForExportedFile('diorama_scene_*', 45_000);
    } catch (error) {
      const toast = await evaluate(devtools.command, `document.querySelector('#toast')?.textContent || ''`);
      throw new Error(`${error.message}; UI toast after video stop: ${toast || '(empty)'}`);
    }
    const video = readDeviceFile(videoPath);
    assert(video.length > 500, `Video file is unexpectedly small (${video.length} bytes): ${videoPath}`);
    if (videoPath.endsWith('.webm')) {
      assert(video.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3])), `Invalid WebM EBML header: ${videoPath}`);
    } else if (videoPath.endsWith('.mp4')) {
      assert.equal(video.toString('ascii', 4, 8), 'ftyp', `Invalid MP4 header: ${videoPath}`);
    } else {
      throw new Error(`Unexpected video extension: ${videoPath}`);
    }
    const preview = await waitForVideoPreview(devtools.command);
    assert(preview.width > 0 && preview.height > 0, `Video preview reported invalid dimensions: ${JSON.stringify(preview)}`);
    const playback = await evaluate(devtools.command, `(() => new Promise((resolve) => {
      const video = document.querySelector('#recording-video-preview');
      let finished = false;
      const complete = (result) => {
        if (finished) return;
        finished = true;
        clearTimeout(timeout);
        video.removeEventListener('ended', onEnded);
        video.removeEventListener('error', onError);
        resolve(result);
      };
      const onEnded = () => complete({ played: true, duration: video.duration });
      const onError = () => complete({ played: false, error: video.error?.message || 'decode failed' });
      const timeout = setTimeout(() => complete({ played: false, error: 'playback timeout' }), 12_000);
      video.muted = true;
      video.playbackRate = 4;
      video.addEventListener('ended', onEnded, { once: true });
      video.addEventListener('error', onError, { once: true });
      video.play().catch((error) => complete({ played: false, error: error.message }));
    }))()`);
    assert.equal(playback.played, true, `Saved recording could not play through in the preview: ${JSON.stringify(playback)}`);
    const previewDuration = Number.isFinite(preview.duration) ? `${preview.duration.toFixed(2)}s` : 'stream duration unavailable';
    console.log(`PASS: Manual Android video saved and played through the in-app preview (${videoPath}; ${video.length} bytes; ${preview.width}x${preview.height}; ${previewDuration}).`);

    console.log('ANDROID USER TEST SUMMARY: 6 tabs, collapse/expand, touch-restorable full-screen mode, timeline edit, project JSON, Android Share sheet, PNG and playable manual video export exercised.');
  } finally {
    delete globalThis.__devtoolsCommand;
    devtools.socket.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
