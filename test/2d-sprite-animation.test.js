import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { SpriteAnimationManager } from '../src/components/SpriteAnimationManager.js';
import { ACTION_TYPES, TimelineManager } from '../src/components/TimelineManager.js';

function makeActor() {
  const offset = { x: 0, y: 0, set(x, y) { this.x = x; this.y = y; } };
  return {
    id: 'sprite-1', name: 'test', columns: 2, rows: 2, frameCount: 4,
    frameWidth: 16, frameHeight: 16, frame: 0, fps: 8, x: 20, y: 30,
    displayHeight: 64, isPlaying: false, loop: true, playbackElapsed: 0,
    frameProgress: 0, duration: null, resolver: null,
    texture: { offset, needsUpdate: false },
    sprite: { position: { set() {} }, scale: { set() {} } },
  };
}

test('2D sprite playback advances grid frames, pauses, and resolves at its duration', async () => {
  const manager = new SpriteAnimationManager(new THREE.Scene(), { width: 400, height: 300 });
  const actor = makeActor();
  manager.actors.push(actor);
  manager.selectedId = actor.id;

  const completed = manager.playAnimation(actor.id, { duration: 0.25, fps: 8, loop: true });
  manager.update(0.125);
  assert.equal(actor.frame, 1);
  assert.deepEqual([actor.texture.offset.x, actor.texture.offset.y], [0.5, 0.5]);

  manager.pauseAll(true);
  manager.update(0.5);
  assert.equal(actor.frame, 1);
  manager.pauseAll(false);
  manager.update(0.125);
  assert.equal(await completed, true);
  assert.equal(actor.isPlaying, false);
});

test('2D sprite keeps its configured frame rate when no override is supplied', () => {
  const manager = new SpriteAnimationManager(new THREE.Scene(), { width: 400, height: 300 });
  const actor = makeActor();
  manager.actors.push(actor);
  manager.selectedId = actor.id;
  manager.playAnimation(actor.id, { duration: null });
  assert.equal(actor.fps, 8);
  manager.stopAnimation(actor.id);
});

test('timeline JSON accepts 2D sprite actions and rejects missing actors or invalid frame rates', () => {
  const timeline = new TimelineManager({});
  timeline.importSequence({ steps: [{
    type: ACTION_TYPES.PLAY_SPRITE_ANIMATION,
    actorId: 'sprite-1',
    startAt: 1,
    duration: 3,
    data: { fps: 12, loop: true },
  }] });
  assert.equal(timeline.steps[0].actorId, 'sprite-1');
  assert.equal(timeline.steps[0].data.fps, 12);
  assert.throws(() => timeline.importSequence({ steps: [{
    type: ACTION_TYPES.PLAY_SPRITE_ANIMATION,
    duration: 1,
    data: { fps: 0, loop: true },
  }] }));
  assert.throws(() => timeline.importSequence({ steps: [{
    type: ACTION_TYPES.PLAY_SPRITE_ANIMATION,
    duration: 1,
    data: { fps: 12, loop: true },
  }] }));
});

test('sprite hit testing and pointer-driven transforms use stage coordinates', () => {
  const manager = new SpriteAnimationManager(new THREE.Scene(), { width: 400, height: 300 });
  const actor = makeActor();
  actor.frameWidth = 32; actor.frameHeight = 32; actor.displayHeight = 64;
  manager.actors.push(actor);
  assert.equal(manager.hitTest(20, 30), actor);
  assert.equal(manager.hitTest(100, 100), null);
  manager.setTransform(actor.id, { x: 380, y: -5, height: 80 });
  assert.deepEqual([actor.x, actor.y, actor.displayHeight], [380, 0, 80]);
});

test('portable project export embeds original sprite image and timeline timing remains serializable', async () => {
  const manager = new SpriteAnimationManager(new THREE.Scene(), { width: 400, height: 300 });
  const actor = makeActor();
  actor.sourceFile = new File([new Uint8Array([1, 2, 3])], 'walk.png', { type: 'image/png' });
  manager.actors.push(actor);
  const [asset] = await manager.exportAssets();
  assert.equal(asset.fileName, 'walk.png');
  assert.equal(asset.data, 'AQID');
  const timeline = new TimelineManager({});
  timeline.steps = [{ id: 'a', type: ACTION_TYPES.PLAY_SPRITE_ANIMATION, actorId: actor.id, startAt: 1.5, duration: 4, data: { fps: 12, loop: false } }];
  const saved = JSON.parse(timeline.exportSequence());
  assert.equal(saved.steps[0].startAt, 1.5);
  assert.equal(saved.steps[0].duration, 4);
  assert.equal(saved.steps[0].data.loop, false);
});
