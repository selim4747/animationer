import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { CollisionManager } from '../src/components/CollisionManager.js';
import { MapLoader } from '../src/components/MapLoader.js';
import { createAutosaveRecord } from '../src/components/ProjectStore.js';

test('wall-box position and dimensions can be edited and remain collision registered', () => {
  const scene = new THREE.Scene();
  const collision = new CollisionManager(scene);
  const map = new MapLoader(scene, collision);
  const box = map.createWallBox(1, 2, 2, 1, 1.5);
  assert.equal(map.updateWallBox(box, { x: -3.5, z: 4, width: 3, depth: 2.5, height: 2 }), true);
  assert.deepEqual(map.exportWallBoxesForStorage()[0], { x: -3.5, z: 4, width: 3, depth: 2.5, height: 2 });
  assert.equal(box.position.y, 1);
  assert.equal(collision.registeredObstacles.find((entry) => entry.object === box).box.getSize(new THREE.Vector3()).x, 3);
  assert.equal(map.updateWallBox(box, { width: -1 }), false);
  map.clear();
});

test('GLB mesh role and visibility edits update collision pools and export as overrides', () => {
  const scene = new THREE.Scene();
  const collision = new CollisionManager(scene);
  const map = new MapLoader(scene, collision);
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(2, 0.1, 2), new THREE.MeshBasicMaterial());
  mesh.name = 'Platform';
  mesh.userData.editorCollisionKind = 'none';
  scene.add(mesh);
  map.meshesByEditorId.set('mesh-0', mesh);
  assert.equal(map.setMeshCollisionKind('mesh-0', 'walkable'), true);
  assert.equal(collision.walkableSurfaces.includes(mesh), true);
  assert.equal(map.setMeshVisible('mesh-0', false), true);
  assert.equal(collision.walkableSurfaces.includes(mesh), false);
  assert.deepEqual(map.exportMeshOverrides(), [{ id: 'mesh-0', kind: 'walkable', visible: false }]);
  map.applyMeshOverrides([{ id: 'mesh-0', kind: 'obstacle', visible: true }], { notify: false });
  assert.equal(collision.registeredObstacles.some((entry) => entry.object === mesh), true);
  assert.deepEqual(map.getEditableMeshes()[0], { id: 'mesh-0', name: 'Platform', visible: true, kind: 'obstacle' });
  map.clear();
  mesh.geometry.dispose(); mesh.material.dispose();
});

test('autosave project record stores and validates sky color and camera station preferences', () => {
  const record = createAutosaveRecord({
    timeline: { version: '1.0.0', playMode: 'sequential', steps: [] },
    sprites: [{ id: 'sprite-test', blob: new Blob(['sprite'], { type: 'image/png' }), fileName: 'sprite.png' }],
    skyColor: '#44aaff',
    cameraStations: [{ id: 'station-ext', name: 'Exterior', position: { x: 1, y: 2, z: 3 }, target: { x: 0, y: 0, z: 0 } }],
    activeCameraStationId: 'station-ext',
    cameraFollowCharacter: false,
  });
  assert.equal(record.skyColor, '44aaff');
  assert.equal(record.cameraStations[0].name, 'Exterior');
  assert.equal(record.activeCameraStationId, 'station-ext');
  assert.equal(record.cameraFollowCharacter, false);
});
