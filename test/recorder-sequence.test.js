import test from 'node:test';
import assert from 'node:assert/strict';
import { RecorderManager } from '../src/components/RecorderManager.js';

test('reports a failed automatic recording when MediaRecorder cannot start', async () => {
  const recorder = new RecorderManager(null);
  recorder._sleep = async () => {};
  const timeline = { steps: [{ type: 'WAIT' }], stop() {}, async play() { return true; } };
  let callbackResult;

  const result = await recorder.recordTimelineSequence(timeline, {
    onAfterFinish: (value) => { callbackResult = value; },
  });

  assert.equal(result.success, false);
  assert.match(result.error, /başlatılamadı/i);
  assert.equal(callbackResult.success, false);
});

test('reports success only after a non-empty video blob is produced', async () => {
  const recorder = new RecorderManager(null);
  recorder._sleep = async () => {};
  recorder.startRecording = () => {
    recorder.isRecording = true;
    return true;
  };
  recorder.stopRecording = async () => {
    recorder.isRecording = false;
    return new Blob(['video']);
  };
  const timeline = { steps: [{ type: 'WAIT' }], stop() {}, async play() { return true; } };

  const result = await recorder.recordTimelineSequence(timeline);
  assert.equal(result.success, true);
  assert.equal(result.blob.size, 5);
});
