import test from 'node:test';
import assert from 'node:assert/strict';
import { createRecordingFilename, RecorderManager } from '../src/components/RecorderManager.js';

class FakeMediaRecorder {
  static isTypeSupported(type) { return type === 'video/webm'; }

  constructor(stream, options) {
    this.stream = stream;
    this.options = options;
    this.mimeType = options.mimeType || 'video/webm';
    this.state = 'inactive';
    FakeMediaRecorder.latest = this;
  }

  start(timeslice) {
    this.timeslice = timeslice;
    this.state = 'recording';
  }

  stop() {
    this.state = 'inactive';
    this.ondataavailable?.({ data: new Blob(['tail'], { type: this.mimeType }) });
    this.onstop?.();
  }
}

function makeCanvas() {
  const track = { stopped: false, stop() { this.stopped = true; } };
  const frameRates = [];
  return {
    track,
    frameRates,
    canvas: {
      captureStream(fps) {
        frameRates.push(fps);
        return { getTracks: () => [track] };
      },
    },
  };
}

function withFakeMediaRecorder(callback) {
  const original = globalThis.MediaRecorder;
  globalThis.MediaRecorder = FakeMediaRecorder;
  return Promise.resolve().then(callback).finally(() => {
    if (original === undefined) delete globalThis.MediaRecorder;
    else globalThis.MediaRecorder = original;
  });
}

test('captures at the selected frame rate and cleans up after a successful save', async () => withFakeMediaRecorder(async () => {
  const { canvas, frameRates, track } = makeCanvas();
  const states = [];
  const manager = new RecorderManager(canvas, { onStateChange: (state) => states.push(state) });
  assert.equal(manager.frameRate, 30);
  manager.setFrameRate(60);
  manager._downloadBlob = async (_blob, filename) => {
    assert.equal(manager.recordedChunks.length, 0, 'Recorder chunk references should be released before saving.');
    return { saved: true, method: 'test', filename };
  };

  assert.equal(manager.startRecording(), true);
  assert.deepEqual(frameRates, [60]);
  assert.equal(FakeMediaRecorder.latest.timeslice, 250);
  const saved = await manager.stopRecording();

  assert(saved instanceof Blob);
  assert(saved.size > 0);
  assert.equal(manager.isRecording, false);
  assert.equal(manager.isFinalizing, false);
  assert.equal(manager.mediaRecorder, null);
  assert.equal(manager.recordedChunks.length, 0);
  assert.equal(manager.recordedBytes, 0);
  assert.equal(track.stopped, true);
  assert(states.some((state) => state.filename?.match(/^diorama_scene_.*\.webm$/)));
}));

test('applies the low-memory device recording profile and prevents selecting 60 FPS', async () => withFakeMediaRecorder(async () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { deviceMemory: 2, userAgent: 'Android' },
  });
  try {
    const { canvas, frameRates } = makeCanvas();
    const manager = new RecorderManager(canvas);
    assert.equal(manager.maxRecordingBytes, 32 * 1024 * 1024);
    assert.equal(manager.maxFrameRate, 30);
    assert.equal(manager.setFrameRate(60), 30);
    manager._downloadBlob = async (_blob, filename) => ({ saved: true, filename });
    assert.equal(manager.startRecording(), true);
    assert.deepEqual(frameRates, [30]);
    await manager.stopRecording();
  } finally {
    if (original) Object.defineProperty(globalThis, 'navigator', original);
    else delete globalThis.navigator;
  }
}));

test('rejects an oversized data chunk without downloading a partial file', async () => withFakeMediaRecorder(async () => {
  const { canvas } = makeCanvas();
  const states = [];
  const manager = new RecorderManager(canvas, {
    maxRecordingBytes: 3,
    onStateChange: (state) => states.push(state),
  });
  let downloadCalled = false;
  manager._downloadBlob = async () => { downloadCalled = true; return { saved: true }; };
  assert.equal(manager.startRecording(), true);

  FakeMediaRecorder.latest.ondataavailable({ data: new Blob(['limit'], { type: 'video/webm' }) });
  const result = await manager._stopPromise;

  const finalState = states.findLast((state) => state.limitExceeded);
  assert.equal(result, null);
  assert.equal(downloadCalled, false);
  assert.equal(finalState.stopReason, 'size-limit');
  assert.match(finalState.error, /sınırı aşıldı/i);
  assert.equal(manager.isRecording, false);
  assert.equal(manager.recordedChunks.length, 0);
}));

test('rejects a stop-event tail that would push the final blob over the byte cap', async () => withFakeMediaRecorder(async () => {
  const { canvas } = makeCanvas();
  const states = [];
  const manager = new RecorderManager(canvas, { maxRecordingBytes: 4, onStateChange: (state) => states.push(state) });
  let downloadCalled = false;
  manager._downloadBlob = async () => { downloadCalled = true; return { saved: true }; };
  assert.equal(manager.startRecording(), true);

  // The first chunk fills the cap and triggers stop; FakeMediaRecorder emits "tail" from stop().
  FakeMediaRecorder.latest.ondataavailable({ data: new Blob(['1234'], { type: 'video/webm' }) });
  const result = await manager._stopPromise;

  assert.equal(result, null);
  assert.equal(downloadCalled, false);
  assert(states.some((state) => state.limitExceeded && state.sizeBytes <= state.maxRecordingBytes));
  assert.equal(manager.lastDownloadResult.limitExceeded, true);
}));

test('stops an automatic timeline at the byte cap and reports that no file was produced', async () => withFakeMediaRecorder(async () => {
  const { canvas } = makeCanvas();
  const manager = new RecorderManager(canvas, { maxRecordingBytes: 1 });
  let downloadCalled = false;
  manager._downloadBlob = async (_blob, filename) => { downloadCalled = true; return { saved: true, filename }; };
  let releasePlayback;
  const timeline = {
    steps: [{ type: 'WAIT' }],
    isPlaying: false,
    stop() {
      if (!this.isPlaying) return;
      this.isPlaying = false;
      releasePlayback?.();
    },
    async play() {
      this.isPlaying = true;
      await new Promise((resolve) => { releasePlayback = resolve; });
      this.isPlaying = false;
      return false;
    },
  };

  const resultPromise = manager.recordTimelineSequence(timeline);
  await new Promise((resolve) => setTimeout(resolve, 600));
  assert.equal(FakeMediaRecorder.latest.state, 'recording');
  FakeMediaRecorder.latest.ondataavailable({ data: new Blob(['cap'], { type: 'video/webm' }) });
  const result = await resultPromise;

  assert.equal(result.success, false);
  assert.match(result.error, /sınırına ulaşıldı.*kısmi/i);
  assert.equal(result.blob, null);
  assert.equal(result.downloadResult.saved, false);
  assert.equal(result.downloadResult.limitExceeded, true);
  assert.equal(downloadCalled, false);
  assert.equal(timeline.isPlaying, false);
}));

test('handles capture-time MediaRecorder errors and releases stream and buffered chunks', async () => withFakeMediaRecorder(async () => {
  const { canvas, track } = makeCanvas();
  const states = [];
  const manager = new RecorderManager(canvas, { onStateChange: (state) => states.push(state) });
  assert.equal(manager.startRecording(), true);
  const recorder = FakeMediaRecorder.latest;
  assert.equal(typeof recorder.onerror, 'function');
  recorder.ondataavailable({ data: new Blob(['partial']) });
  recorder.onerror({ error: new Error('capture failed') });

  assert.equal(manager.isRecording, false);
  assert.equal(manager.isFinalizing, false);
  assert.equal(manager.mediaRecorder, null);
  assert.equal(manager.recordedChunks.length, 0);
  assert.equal(track.stopped, true);
  assert(states.some((state) => /capture failed/.test(state.error || '')));
}));

test('generates distinct video filenames for recordings created at the same instant', () => {
  const sameInstant = new Date('2026-10-25T20:00:00.000Z');
  const first = createRecordingFilename('video/webm', sameInstant);
  const second = createRecordingFilename('video/webm', sameInstant);
  assert.notEqual(first, second);
  assert.match(first, /^diorama_scene_.*\.webm$/);
});
