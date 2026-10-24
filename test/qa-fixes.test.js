import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { CameraManager } from '../src/components/CameraManager.js';
import { CharacterRoster } from '../src/components/CharacterRoster.js';
import { CollisionManager } from '../src/components/CollisionManager.js';
import { toRendererViewport } from '../src/components/ViewportLayout.js';
import { ACTION_TYPES, TimelineManager } from '../src/components/TimelineManager.js';

test('camera presets transition independently from the saved CCTV station list', () => {
  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
  camera.position.set(10, 8, 10);
  const manager = Object.create(CameraManager.prototype);
  Object.assign(manager, {
    camera,
    controls: { target: new THREE.Vector3(), enabled: true },
    stations: [{ id: 'station-ext' }],
    activeStationId: null,
    activePresetId: null,
    presets: [
      { id: 'front', name: 'Ön', offset: new THREE.Vector3(0, 2.4, 8) },
      { id: 'side', name: 'Yan', offset: new THREE.Vector3(8, 2.4, 0) },
      { id: 'top', name: 'Üst', offset: new THREE.Vector3(0, 11, 0.01) },
      { id: 'isometric', name: 'İzometrik', offset: new THREE.Vector3(8, 6, 8) },
    ],
    startPos: new THREE.Vector3(), startTarget: new THREE.Vector3(),
    endPos: new THREE.Vector3(), endTarget: new THREE.Vector3(),
    isTourActive: false, onStateChange() {},
  });
  const target = new THREE.Vector3(1, 2, 3);
  const stationCount = manager.stations.length;
  assert.equal(manager.transitionToPreset('front', target), true);
  assert.equal(manager.activePresetId, 'front');
  assert.equal(manager.stations.length, stationCount);
  assert.ok(manager.endPos.distanceTo(new THREE.Vector3(1, 4.4, 11)) < 0.001);
  assert.ok(manager.endTarget.equals(target));
  assert.equal(manager.transitionToPreset('unknown', target), false);
  manager.setFreeMode();
  assert.equal(manager.activePresetId, null);
  assert.equal(manager.controls.enabled, true);
});

test('CSS preview rectangle converts to a clipped bottom-left renderer viewport', () => {
  assert.deepEqual(toRendererViewport({ left: 300, top: 40, width: 240, height: 150 }, 800, 600), {
    x: 300, y: 410, width: 240, height: 150,
  });
  assert.deepEqual(toRendererViewport({ left: 760, top: 550, width: 100, height: 100 }, 800, 600), {
    x: 760, y: 0, width: 40, height: 50,
  });
});

test('new roster actors choose an unoccupied point around registered obstacles', () => {
  const scene = new THREE.Scene();
  const collision = new CollisionManager(scene);
  const obstacle = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2), new THREE.MeshBasicMaterial());
  obstacle.position.set(1.35, 1, 0);
  scene.add(obstacle);
  collision.registerObstacle(obstacle);
  const roster = new CharacterRoster(scene, collision);
  const spawned = roster.addCharacter('Yeni');
  const p = spawned.character.getPosition();
  collision.updateObstacleBoxes();
  const box = collision.registeredObstacles[0].box;
  const closestX = Math.max(box.min.x, Math.min(p.x, box.max.x));
  const closestZ = Math.max(box.min.z, Math.min(p.z, box.max.z));
  assert.ok(Math.hypot(p.x - closestX, p.z - closestZ) >= 0.42);
  assert.ok(Math.hypot(p.x, p.z) >= 0.77);
});

test('roster refuses to add an actor when all candidate spawn points are blocked', () => {
  const scene = new THREE.Scene();
  const collision = new CollisionManager(scene);
  const obstacle = new THREE.Mesh(new THREE.BoxGeometry(40, 2, 40), new THREE.MeshBasicMaterial());
  obstacle.position.y = 1;
  scene.add(obstacle);
  collision.registerObstacle(obstacle);
  const roster = new CharacterRoster(scene, collision);
  assert.throws(() => roster.addCharacter('Blocked'), /boş karakter doğma noktası bulunamadı/i);
  assert.equal(roster.list().length, 1);
});

test('individual wall-box removal unregisters exactly one collider and updates remaining list', () => {
  const scene = new THREE.Scene();
  const collision = new CollisionManager(scene);
  const first = collision.addWallBox(0, 0);
  const second = collision.addWallBox(4, 0);
  assert.equal(collision.wallBoxes.length, 2);
  assert.equal(collision.registeredObstacles.length, 2);
  collision.removeWallBox(first);
  assert.deepEqual(collision.wallBoxes, [second]);
  assert.equal(collision.registeredObstacles.some(({ object }) => object === first), false);
  assert.equal(collision.registeredObstacles.some(({ object }) => object === second), true);
  collision.clearWallBoxes();
  assert.equal(collision.wallBoxes.length, 0);
  assert.equal(collision.registeredObstacles.length, 0);
});

test('stopping a sequential MOVE_TO cancels actor motion and resolves playback as aborted', async () => {
  const roster = new CharacterRoster(new THREE.Scene(), null);
  const actor = roster.selectedCharacter;
  const timeline = new TimelineManager({ character: roster });
  timeline.steps = [{ type: ACTION_TYPES.MOVE_TO, actorId: 'character-1', data: { x: 20, y: 0, z: 0 } }];
  const playback = timeline.play();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(actor.isMoving, true);
  timeline.stop();
  assert.equal(await playback, false);
  assert.equal(actor.isMoving, false);
});
