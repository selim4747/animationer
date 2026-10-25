import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { MapLoader } from '../src/components/MapLoader.js';

function makeLoader() {
  const scene = new THREE.Scene();
  const statuses = [];
  const changes = [];
  const loader = new MapLoader(scene, null, (status) => statuses.push(status), (change) => changes.push(change));
  loader.textureLoader = { async loadAsync() { return new THREE.Texture({ width: 64, height: 32 }); } };
  return { loader, scene, statuses, changes };
}

test('2D environment retains its source Blob and round-trips orientation, scale and opacity', async () => {
  const { loader, scene, changes } = makeLoader();
  const source = new Blob(['floor-image'], { type: 'image/png' });
  await loader.loadImage('blob:floor', 'floor.png', source);
  loader.setScale(12);
  loader.setOpacity(0.6);
  loader.setOrientation(false);
  const state = loader.exportStateForStorage();
  assert.equal(state.fileName, 'floor.png');
  assert.equal(state.blob.size, source.size);
  assert.equal(state.scale, 12);
  assert.equal(state.opacity, 0.6);
  assert.equal(state.groundOrientation, false);
  assert.ok(loader.stateRevision > 0);
  assert.ok(changes.length >= 4);
  assert.equal(scene.children.includes(loader.currentPlane), true);

  const restored = makeLoader().loader;
  restored.textureLoader = { async loadAsync() { return new THREE.Texture({ width: 64, height: 32 }); } };
  await restored.restoreProjectState(state);
  assert.equal(restored.currentObjectType, '2d');
  assert.equal(restored.currentScale, 12);
  assert.equal(restored.currentOpacity, 0.6);
  assert.equal(restored.isGroundOrientation, false);
  loader.clear();
  restored.clear();
});

test('failed replacement leaves the previous 2D environment and persistent source intact', async () => {
  const { loader, scene, statuses } = makeLoader();
  const source = new Blob(['old-map'], { type: 'image/png' });
  await loader.loadImage('blob:old', 'old.png', source);
  const oldPlane = loader.currentPlane;
  const oldTexture = loader.currentTexture;
  loader.textureLoader = { async loadAsync() { throw new Error('decode failed'); } };
  await assert.rejects(loader.loadImage('blob:new', 'new.png', new Blob(['bad'], { type: 'image/png' })), /decode failed/);
  assert.equal(loader.currentPlane, oldPlane);
  assert.equal(loader.currentTexture, oldTexture);
  assert.equal(scene.children.includes(oldPlane), true);
  assert.equal(loader.exportStateForStorage().fileName, 'old.png');
  assert.equal(statuses.at(-1).type, 'error');
  loader.clear();
});
