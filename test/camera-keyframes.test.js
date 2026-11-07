import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { CameraManager } from '../src/components/CameraManager.js';

function createCameraManager() {
  const manager = Object.create(CameraManager.prototype);
  manager.camera = new THREE.PerspectiveCamera();
  manager.controls = { target: new THREE.Vector3(0, 0, 0), enabled: true, update() {} };
  manager.stations = [{ id: 'station-ext', name: 'Outside' }];
  manager.activeStationId = null;
  manager.activePresetId = null;
  manager.followCharacter = true;
  manager.isTourActive = false;
  manager.tourTimer = null;
  manager.isTransitioning = false;
  manager.transitionStartTime = 0;
  manager.transitionDuration = 900;
  manager.transitionEasing = 'easeInOutCubic';
  manager.startPos = new THREE.Vector3();
  manager.startTarget = new THREE.Vector3();
  manager.endPos = new THREE.Vector3();
  manager.endTarget = new THREE.Vector3();
  manager.transitionResolve = null;
  manager._keyframeHold = false;
  manager._isTimelinePoseTransition = false;
  manager._transitionPausedAt = null;
  manager.states = [];
  manager.onStateChange = (state) => manager.states.push(state);
  return manager;
}

const pose = {
  position: { x: 4, y: 6, z: 8 },
  target: { x: 1, y: 2, z: 3 },
};

test('camera keyframe interpolates to pose without creating or replacing a saved station', async () => {
  const manager = createCameraManager();
  const before = manager.stations.slice();
  const transition = manager.transitionToPosePromise(pose, { duration: 0.1, easing: 'linear' });
  assert.equal(manager.activeStationId, null);
  assert.equal(manager._keyframeHold, true);
  assert.equal(manager.stations.length, 1);

  manager.transitionStartTime = performance.now() - 101;
  manager.update(0, new THREE.Vector3(100, 0, 0), null);
  await transition;

  assert.deepEqual(manager.camera.position.toArray(), [4, 6, 8]);
  assert.deepEqual(manager.controls.target.toArray(), [1, 2, 3]);
  assert.equal(manager.controls.enabled, false);
  assert.deepEqual(manager.stations, before);
  assert.equal(manager.releaseTimelinePose(), true);
  assert.equal(manager.controls.enabled, true);
  assert.equal(manager.releaseTimelinePose(), false);
});

test('camera keyframe rejects non-finite pose, excessive coordinates, duration and easing', async () => {
  const manager = createCameraManager();
  await assert.rejects(manager.transitionToPosePromise({ ...pose, target: { x: 0, y: Infinity, z: 0 } }));
  await assert.rejects(manager.transitionToPosePromise({ ...pose, position: { x: 10001, y: 0, z: 0 } }));
  await assert.rejects(manager.transitionToPosePromise(pose, { duration: 0 }));
  await assert.rejects(manager.transitionToPosePromise(pose, { easing: 'bounce' }));
});

test('pause freezes an in-flight pose transition and resume excludes paused time', async () => {
  const manager = createCameraManager();
  const transition = manager.transitionToPosePromise(pose, { duration: 1 });
  const startTime = manager.transitionStartTime;
  manager.setTimelinePaused(true);
  const cameraAtPause = manager.camera.position.clone();
  await new Promise((resolve) => setTimeout(resolve, 15));
  manager.update(0, null, null);
  assert.deepEqual(manager.camera.position.toArray(), cameraAtPause.toArray());
  manager.setTimelinePaused(false);
  assert.ok(manager.transitionStartTime > startTime);
  manager.cancelTransition();
  await transition;
  assert.equal(manager._keyframeHold, false);
});

test('a replacement transition resolves the prior keyframe promise and stop cancels the active pose', async () => {
  const manager = createCameraManager();
  const first = manager.transitionToPosePromise(pose, { duration: 5 });
  let firstResolved = false;
  first.then(() => { firstResolved = true; });
  const second = manager.transitionToPosePromise({ position: { x: 7, y: 8, z: 9 }, target: { x: 1, y: 1, z: 1 } }, { duration: 5 });
  await first;
  assert.equal(firstResolved, true);
  assert.equal(manager.cancelTransition(), true);
  await second;
  assert.equal(manager.isTransitioning, false);
  assert.equal(manager._keyframeHold, false);
  assert.equal(manager.controls.enabled, true);
});
