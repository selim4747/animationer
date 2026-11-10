import test from 'node:test';
import assert from 'node:assert/strict';
import { ACTION_TYPES, TimelineManager } from '../src/components/TimelineManager.js';

const data = {
  position: { x: 4, y: 5, z: 6 },
  target: { x: 0, y: 1, z: 0 },
  easing: 'linear',
};

 test('sequential playback executes camera keyframes with duration/easing and releases the final pose', async () => {
  const transitions = [];
  let released = 0;
  const cameraManager = {
    transitionToPosePromise: async (pose, options) => transitions.push({ pose, options }),
    releaseTimelinePose: () => { released += 1; },
  };
  const timeline = new TimelineManager({ cameraManager, initialDemo: false });
  timeline.addStep(ACTION_TYPES.CAMERA_KEYFRAME, structuredClone(data), 'Camera pose', { duration: 1.5 });

  assert.equal(await timeline.play(), true);
  assert.deepEqual(transitions, [{ pose: data, options: { duration: 1.5, easing: 'linear' } }]);
  assert.equal(released, 1);
});

test('pause/resume reaches camera transition and stop cancels its pending promise', async () => {
  const pausedValues = [];
  let finishTransition;
  let cancellations = 0;
  const cameraManager = {
    transitionToPosePromise: () => new Promise((resolve) => { finishTransition = resolve; }),
    setTimelinePaused: (paused) => pausedValues.push(paused),
    cancelTransition: () => { cancellations += 1; finishTransition?.(); },
    releaseTimelinePose() {},
  };
  const timeline = new TimelineManager({ cameraManager, initialDemo: false });
  timeline.addStep(ACTION_TYPES.CAMERA_KEYFRAME, structuredClone(data), 'Camera pose', { duration: 3 });
  const playback = timeline.play();
  await new Promise((resolve) => setImmediate(resolve));
  timeline.pause();
  assert.deepEqual(pausedValues, [true]);
  await timeline.play();
  assert.deepEqual(pausedValues, [true, false]);
  timeline.stop();
  await playback;
  assert.equal(cancellations, 1);
});

test('scheduled playback rejects overlapping camera keyframes before starting either transition', async () => {
  const transitions = [];
  const timeline = new TimelineManager({
    cameraManager: { transitionToPosePromise: async (pose) => transitions.push(pose) },
    initialDemo: false,
  });
  timeline.addStep(ACTION_TYPES.CAMERA_KEYFRAME, structuredClone(data), 'First pose', { startAt: 0, duration: 2 });
  timeline.addStep(ACTION_TYPES.CAMERA_KEYFRAME, structuredClone(data), 'Overlapping pose', { startAt: 1, duration: 2 });
  timeline.setPlayMode('scheduled');

  assert.equal(await timeline.play(), false);
  assert.equal(timeline.isPlaying, false);
  assert.deepEqual(transitions, []);
  assert.match(timeline.lastPlaybackError, /kamera geçişleri çakışamaz/i);
});

test('scheduled playback also rejects a camera keyframe overlapping a station switch', async () => {
  const timeline = new TimelineManager({
    cameraManager: { transitionToPosePromise: async () => {}, transitionToStationPromise: async () => {} },
    initialDemo: false,
  });
  timeline.addStep(ACTION_TYPES.CAMERA_KEYFRAME, structuredClone(data), 'Pose', { startAt: 0, duration: 2 });
  timeline.addStep(ACTION_TYPES.SWITCH_CAMERA, { stationId: 'wide' }, 'Switch camera', { startAt: 1 });
  timeline.setPlayMode('scheduled');

  assert.equal(await timeline.play(), false);
  assert.equal(timeline.isPlaying, false);
  assert.match(timeline.lastPlaybackError, /kamera geçişleri çakışamaz/i);
});


test('manual camera keyframe execution awaits the transition, locks edits and releases camera controls', async () => {
  let finishTransition;
  let releaseCount = 0;
  const cameraManager = {
    transitionToPosePromise: () => new Promise((resolve) => { finishTransition = resolve; }),
    releaseTimelinePose: () => { releaseCount += 1; },
  };
  const timeline = new TimelineManager({ cameraManager, initialDemo: false });
  timeline.addStep(ACTION_TYPES.CAMERA_KEYFRAME, structuredClone(data), 'Manual pose', { duration: 1.5 });

  const execution = timeline.runStep(0);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(timeline.isPlaying, true);
  assert.equal(timeline.isSingleStepRunning, true);
  assert.equal(timeline.moveStep(0, 0), false);
  assert.equal(releaseCount, 0, 'camera hold remains until the transition promise finishes');

  finishTransition();
  assert.equal(await execution, true);
  assert.equal(timeline.isPlaying, false);
  assert.equal(timeline.isSingleStepRunning, false);
  assert.equal(timeline.currentStepIndex, -1);
  assert.equal(releaseCount, 1);
});

test('manual camera keyframe failures still release the camera pose and expose the error', async () => {
  let releaseCount = 0;
  const timeline = new TimelineManager({
    cameraManager: {
      transitionToPosePromise: async () => { throw new Error('camera transition failed'); },
      releaseTimelinePose: () => { releaseCount += 1; },
    },
    initialDemo: false,
  });
  timeline.addStep(ACTION_TYPES.CAMERA_KEYFRAME, structuredClone(data), 'Broken pose');

  assert.equal(await timeline.runStep(0), false);
  assert.equal(timeline.isPlaying, false);
  assert.equal(timeline.isSingleStepRunning, false);
  assert.equal(releaseCount, 1);
  assert.equal(timeline.lastPlaybackError, 'camera transition failed');
});
