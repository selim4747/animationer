import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { LayerManager } from '../src/components/LayerManager.js';
import { ACTION_TYPES, TimelineManager } from '../src/components/TimelineManager.js';

function makeFakeTexture() {
  const texture = new THREE.Texture();
  texture.image = { width: 100, height: 80, naturalWidth: 100, naturalHeight: 80 };
  texture.dispose = () => {};
  return texture;
}

test('LayerManager adds layers, toggles visibility, and reorders', async () => {
  const scene = new THREE.Scene();
  const manager = new LayerManager(scene, { width: 800, height: 600 });
  manager._loadTexture = async () => makeFakeTexture();

  const file = new Blob(['img'], { type: 'image/png' });
  Object.defineProperty(file, 'name', { value: 'bg.png' });

  const id1 = await manager.addLayer(file, { name: 'Arka' });
  const id2 = await manager.addLayer(file, { name: 'Ön' });

  assert.equal(manager.layers.length, 2);
  assert.equal(manager.list()[1].name, 'Ön');

  manager.setVisible(id1, false);
  assert.equal(manager.list().find((l) => l.id === id1).visible, false);
  assert.equal(scene.children.find((c) => c === manager.layers[0].sprite).visible, false);

  manager.moveLayer(id1, 'up');
  assert.equal(manager.list()[1].id, id1);

  manager.setOpacity(id2, 0.4);
  assert.equal(manager.list().find((l) => l.id === id2).opacity, 0.4);
});

test('Timeline applies layer visibility and opacity steps during playback', async () => {
  const scene = new THREE.Scene();
  const manager = new LayerManager(scene, { width: 800, height: 600 });
  manager._loadTexture = async () => makeFakeTexture();
  const file = new Blob(['img'], { type: 'image/png' });
  Object.defineProperty(file, 'name', { value: 'layer.png' });
  const id = await manager.addLayer(file);

  const timeline = new TimelineManager({ layerManager: manager, initialDemo: false });
  timeline.steps = [
    { id: 's1', type: ACTION_TYPES.SET_LAYER_VISIBILITY, actorId: id, data: { visible: false } },
    { id: 's2', type: ACTION_TYPES.SET_LAYER_OPACITY, actorId: id, data: { opacity: 0.25 } },
  ];

  await timeline.play();
  // Sequential play should have applied both
  const layer = manager.list()[0];
  assert.equal(layer.visible, false);
  assert.equal(layer.opacity, 0.25);
});
