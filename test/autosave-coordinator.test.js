import test from 'node:test';
import assert from 'node:assert/strict';
import { AutosaveCoordinator } from '../src/components/AutosaveCoordinator.js';

class TimelineStub {
  constructor() { this.steps = [{ id: 'wait-1', type: 'WAIT', duration: 1 }]; this.playMode = 'sequential'; this.onStateChange = () => {}; }
  exportSequence() { return JSON.stringify({ version: '1.0', playMode: this.playMode, steps: this.steps }); }
  importSequence(value) { this.steps = [...value.steps]; this.playMode = value.playMode; }
  _notify(state = {}) { this.onStateChange(state); }
}

function setup() {
  const timeline = new TimelineStub();
  const sprites = { onStateChange: () => {}, async exportAssetsForStorage() { return []; }, async importAssets() {} };
  const mapAsset = { kind: 'image', fileName: 'floor.png', mimeType: 'image/png', blob: new Blob(['map']), scale: 16, opacity: 1, groundOrientation: true, stateRevision: 1 };
  const actors = [{ id: 'world2d-1', name: 'Hero', templateId: 'hero', x: 1, y: 0, z: -2 }];
  const worldSprites = {
    onStateChange: () => {},
    async exportProjectStateForStorage() { return { templates: [{ id: 'hero', name: 'Hero', blob: new Blob(['sheet']), mimeType: 'image/png', fileName: 'hero.png', columns: 1, rows: 1, fps: 12 }], actors }; },
    async importProjectState(value) { this.restored = value; },
  };
  const saved = [];
  const store = {
    async load() { return null; },
    async save(record) { await new Promise((resolve) => setTimeout(resolve, 15)); saved.push(record); return new Date().toISOString(); },
  };
  const coordinator = new AutosaveCoordinator({
    timeline, sprites, worldSprites, mapLoader: { exportStateForStorage: () => mapAsset }, projectStore: store,
    onStatus: () => {}, onError: (message) => { throw new Error(message); },
  });
  return { coordinator, timeline, saved };
}

test('autosave includes the 2D map and placed world-character source bundle', async () => {
  const { coordinator, timeline, saved } = setup();
  await coordinator.connect();
  timeline.steps = [...timeline.steps, { id: 'edit', type: 'WAIT', duration: 0.5 }];
  await coordinator.save();
  assert.equal(saved.length, 1);
  assert.equal(saved[0].mapAsset.fileName, 'floor.png');
  assert.equal(saved[0].worldCharacterTemplates[0].id, 'hero');
  assert.equal(saved[0].worldCharacters[0].z, -2);
  await coordinator.save();
  assert.equal(saved.length, 1, 'unchanged project should not be rewritten');
});

test('playback-only notifications do not trigger writes, while later edits are serialized', async () => {
  const { coordinator, timeline, saved } = setup();
  await coordinator.connect();
  timeline._notify({ isPlaying: true });
  await new Promise((resolve) => setTimeout(resolve, 750));
  assert.equal(saved.length, 0);

  timeline.steps = [...timeline.steps, { id: 'wait-2', type: 'WAIT', duration: 2 }];
  const first = coordinator.save();
  const second = coordinator.save();
  await Promise.all([first, second]);
  assert.equal(saved.length, 1);
  assert.equal(saved[0].timeline.steps.length, 2);
});
