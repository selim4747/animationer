import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { CollisionManager } from '../src/components/CollisionManager.js';
import { MapLoader } from '../src/components/MapLoader.js';
import { SceneEditor } from '../src/components/SceneEditor.js';
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
  assert.deepEqual(map.exportMeshOverrides(), [{
    id: 'mesh-0', kind: 'walkable', visible: false,
    transform: {
      position: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
    },
  }]);
  map.applyMeshOverrides([{ id: 'mesh-0', kind: 'obstacle', visible: true }], { notify: false });
  assert.equal(collision.registeredObstacles.some((entry) => entry.object === mesh), true);
  assert.deepEqual(map.getEditableMeshes()[0], {
    id: 'mesh-0', name: 'Platform', visible: true, kind: 'obstacle',
    transform: {
      position: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
    },
  });
  map.clear();
  mesh.geometry.dispose(); mesh.material.dispose();
});

test('scene editor applies, restores and resets saved world-space transforms', () => {
  const scene = new THREE.Scene();
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial());
  mesh.name = 'Editable';
  mesh.userData.sceneEditorId = 'scene:editable';
  scene.add(mesh);
  const editor = new SceneEditor({ scene });
  assert.equal(editor.select('scene:editable').label, 'Editable');
  assert.equal(editor.setTransform('scene:editable', {
    position: { x: 4, y: 2, z: -3 },
    rotation: { x: 0, y: Math.PI / 2, z: 0 },
    scale: { x: 2, y: 1, z: 0.5 },
  }), true);
  const saved = editor.exportProjectState();
  const replacement = new SceneEditor({ scene });
  mesh.position.set(0, 0, 0);
  mesh.rotation.set(0, 0, 0);
  mesh.scale.set(1, 1, 1);
  replacement.restoreProjectState(saved);
  assert.deepEqual(mesh.position.toArray(), [4, 2, -3]);
  assert.equal(mesh.rotation.y, Math.PI / 2);
  assert.deepEqual(mesh.scale.toArray(), [2, 1, 0.5]);
  assert.equal(replacement.resetTransform('scene:editable'), true);
  assert.deepEqual(mesh.position.toArray(), [0, 0, 0]);
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
