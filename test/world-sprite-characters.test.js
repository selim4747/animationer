import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Character } from '../src/components/Character.js';
import { CollisionManager } from '../src/components/CollisionManager.js';
import { WorldSpriteCharacterManager } from '../src/components/WorldSpriteCharacterManager.js';

function createManager({ blocked = false } = {}) {
  const scene = new THREE.Scene();
  const calls = [];
  const collisionManager = {
    getFloorHeight: () => 0.25,
    clampTargetOutsideObstacles: (point) => point.clone(),
    resolveMovement: (position, step, radius, height) => {
      calls.push({ position: position.clone(), step: step.clone(), radius, height });
      return { resolvedStep: blocked ? new THREE.Vector3() : step.clone(), isColliding: blocked };
    },
  };
  const manager = new WorldSpriteCharacterManager(scene, collisionManager, { store: {} });
  const texture = new THREE.Texture({ width: 32, height: 16 });
  texture.repeat.set(0.25, 0.5);
  manager.templates.set('hero', {
    id: 'hero', name: 'Hero', columns: 4, rows: 2, fps: 8,
    frameWidth: 8, frameHeight: 8, texture,
  });
  return { manager, scene, calls };
}

test('spawns a named 2D character as a world-space billboard with feet at its anchor', () => {
  const { manager, scene } = createManager();
  const actor = manager.spawn('hero', { x: 2, y: 0, z: -3 });
  assert.equal(scene.children.includes(actor.sprite), true);
  assert.equal(actor.sprite.center.x, 0.5);
  assert.equal(actor.sprite.center.y, 0);
  assert.equal(actor.sprite.material.depthTest, true);
  assert.equal(actor.sprite.material.depthWrite, false);
  assert.equal(actor.position.x, 2);
  assert.equal(actor.position.y, 0.25);
  assert.equal(manager.getActor(actor.id), actor);
  manager.dispose();
});

test('world 2D character tap movement uses the 3D collision resolver and advances spritesheet frames', () => {
  const { manager, calls } = createManager();
  const actor = manager.spawn('hero', { x: 0, y: 0, z: 0 });
  manager.setControlMode(true);
  assert.equal(manager.moveSelectedTo({ x: 1.5, y: 0, z: 0 }), true);
  manager.update(0.1);
  manager.update(0.1);
  assert.equal(actor.frame, 1);
  for (let index = 0; index < 20 && actor.isMoving; index++) manager.update(0.1);
  assert.equal(actor.isMoving, false);
  assert.ok(Math.abs(actor.position.x - 1.5) < 0.06);
  assert.equal(actor.position.y, 0.25);
  assert.ok(calls.length > 0);
  assert.ok(calls.every((call) => call.radius > 0 && call.height === actor.characterHeight));
  manager.dispose();
});

test('world obstacle collision stops a 2D character instead of passing through', () => {
  const { manager, calls } = createManager({ blocked: true });
  const actor = manager.spawn('hero', { x: 0, y: 0, z: 0 });
  manager.setControlMode(true);
  manager.moveSelectedTo({ x: 4, y: 0, z: 0 });
  manager.update(0.1);
  assert.equal(actor.isMoving, false);
  assert.equal(actor.position.x, 0);
  assert.ok(calls.length > 0);
  manager.dispose();
});

test('world-space 2D character respects an actual 3D obstacle bounding box', () => {
  const scene = new THREE.Scene();
  const collisionManager = new CollisionManager(scene);
  const wall = new THREE.Mesh(new THREE.BoxGeometry(0.8, 2, 2), new THREE.MeshBasicMaterial());
  wall.position.set(1.5, 1, 0);
  scene.add(wall);
  collisionManager.registerObstacle(wall);
  const manager = new WorldSpriteCharacterManager(scene, collisionManager, { store: {} });
  const texture = new THREE.Texture({ width: 16, height: 16 });
  manager.templates.set('hero', { id: 'hero', name: 'Hero', columns: 1, rows: 1, fps: 12, frameWidth: 16, frameHeight: 16, texture });
  const actor = manager.spawn('hero', { x: 0, y: 0, z: 0 });
  manager.setControlMode(true);
  manager.moveSelectedTo({ x: 3, y: 0, z: 0 });
  for (let index = 0; index < 20 && actor.isMoving; index++) manager.update(0.1);
  assert.ok(actor.position.x < 0.75, `actor passed into wall at x=${actor.position.x}`);
  manager.dispose();
});

test('existing 3D characters also collide with spawned 2D world-character colliders', () => {
  const scene = new THREE.Scene();
  const collisionManager = new CollisionManager(scene);
  const manager = new WorldSpriteCharacterManager(scene, collisionManager, { store: {} });
  const texture = new THREE.Texture({ width: 16, height: 16 });
  manager.templates.set('hero', { id: 'hero', name: 'Hero', columns: 1, rows: 1, fps: 12, frameWidth: 16, frameHeight: 16, texture });
  manager.spawn('hero', { x: 1.5, y: 0, z: 0 });
  const character = new Character(scene, collisionManager);
  character.setControlVector(1, 0);
  for (let index = 0; index < 8; index++) character.update(0.1);
  assert.ok(character.getPosition().x < 0.9, `3D character passed through 2D actor at x=${character.getPosition().x}`);
  character.stopMotion();
  manager.dispose();
});

test('reusing one saved template spawns new characters at free positions', () => {
  const { manager } = createManager();
  const first = manager.spawn('hero');
  const second = manager.spawn('hero');
  const distance = Math.hypot(first.position.x - second.position.x, first.position.z - second.position.z);
  assert.ok(distance >= first.collisionRadius + second.collisionRadius);
  manager.dispose();
});

test('world-space characters block each other and can be removed independently', () => {
  const { manager, scene } = createManager();
  const first = manager.spawn('hero', { x: 0, y: 0, z: 0 });
  const second = manager.spawn('hero', { x: 2, y: 0, z: 0 });
  manager.select(first.id);
  manager.moveSelectedTo({ x: 3, y: 0, z: 0 });
  for (let index = 0; index < 20 && first.isMoving; index++) manager.update(0.1);
  const separation = Math.hypot(first.position.x - second.position.x, first.position.z - second.position.z);
  assert.ok(separation >= first.collisionRadius + second.collisionRadius - 0.05);
  assert.equal(manager.remove(second.id), true);
  assert.equal(scene.children.includes(second.sprite), false);
  assert.equal(manager.listActors().length, 1);
  manager.dispose();
});
