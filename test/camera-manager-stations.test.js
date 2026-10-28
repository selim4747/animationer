import test from 'node:test';
import assert from 'node:assert/strict';
import { CameraManager } from '../src/components/CameraManager.js';

function manager() {
  const instance = Object.create(CameraManager.prototype);
  const states = [];
  instance.stations = [
    { id: 'station-ext', name: 'Outside' },
    { id: 'station-interior-cctv', name: 'Interior' },
    { id: 'user-1', name: 'Saved' },
  ];
  instance.activeStationId = 'user-1';
  instance.activePresetId = null;
  instance.onStateChange = (state) => states.push(state);
  instance.isTourActive = false;
  instance.tourIndex = 0;
  instance.tourTimer = null;
  instance.stopTour = CameraManager.prototype.stopTour.bind(instance);
  instance.setFreeMode = () => { instance.activeStationId = null; states.push({ mode: 'free', activeId: null }); };
  return { instance, states };
}

test('renameStation trims names and rejects empty, overlong, unknown or non-string input', () => {
  const { instance } = manager();
  assert.equal(instance.renameStation('user-1', '  New name  '), true);
  assert.equal(instance.stations[2].name, 'New name');
  assert.equal(instance.renameStation('user-1', '  '), false);
  assert.equal(instance.renameStation('user-1', 'x'.repeat(81)), false);
  assert.equal(instance.renameStation('missing', 'Valid'), false);
  assert.equal(instance.renameStation('user-1', null), false);
  assert.equal(instance.renameStation('user-1', 'x'.repeat(80)), true);
});

test('reorderStation uses zero-based indices, protects exterior default and preserves active ID', () => {
  const { instance } = manager();
  assert.equal(instance.reorderStation('station-ext', 2), false);
  assert.equal(instance.reorderStation('user-1', 0), false);
  assert.equal(instance.reorderStation('user-1', 1), true);
  assert.deepEqual(instance.stations.map((item) => item.id), ['station-ext', 'user-1', 'station-interior-cctv']);
  assert.equal(instance.activeStationId, 'user-1');
  assert.equal(instance.reorderStation('station-interior-cctv', 3), false);
  assert.equal(instance.reorderStation('missing', 0), false);
  assert.equal(instance.reorderStation('station-interior-cctv', 1.5), false);
});

test('removeStation protects exterior, allows interior, and frees only a removed active station', () => {
  const { instance } = manager();
  assert.equal(instance.removeStation('station-ext'), false);
  assert.equal(instance.removeStation('station-interior-cctv'), true);
  assert.equal(instance.activeStationId, 'user-1');
  assert.equal(instance.removeStation('user-1'), true);
  assert.equal(instance.activeStationId, null);
});

test('list mutations keep active tour index valid and stop when fewer than two stations remain', () => {
  const { instance } = manager();
  instance.isTourActive = true;
  instance.tourIndex = 2;
  assert.equal(instance.removeStation('station-interior-cctv'), true);
  assert.ok(instance.tourIndex >= 0 && instance.tourIndex < instance.stations.length);
  assert.equal(instance.removeStation('user-1'), true);
  assert.equal(instance.isTourActive, false);
  assert.equal(instance.tourIndex, 0);
});

test('tour step safely stops for invalidly short lists and does not index missing stations', () => {
  const { instance } = manager();
  instance.isTourActive = true;
  instance.stations = [];
  instance.tourIndex = 4;
  instance._playTourStep();
  assert.equal(instance.isTourActive, false);
  assert.equal(instance.tourIndex, 0);
});

test('camera preferences round-trip station data and keep the exterior station protected at index zero', () => {
  const { instance } = manager();
  instance.restoreProjectState({
    stations: [{ id: 'custom', name: 'Custom', position: { x: 3, y: 4, z: 5 }, target: { x: 0, y: 1, z: 0 } }],
    activeStationId: 'custom', followCharacter: false,
  });
  const saved = instance.exportProjectStateForStorage();
  assert.equal(saved.stations[0].id, 'station-ext');
  assert.equal(saved.stations[1].id, 'station-interior-cctv');
  assert.equal(saved.stations[2].id, 'custom');
  assert.equal(saved.stations[2].position.x, 3);
  assert.equal(saved.activeStationId, 'custom');
  assert.equal(saved.followCharacter, false);
});
