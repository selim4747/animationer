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

test('scheduled timeline plays three 2D sprites concurrently at their start times and loops frames', async () => {
  const manager = new SpriteAnimationManager(new THREE.Scene(), { width: 400, height: 300 });
  const actors = ['QA_Sprite_A', 'QA_Sprite_B', 'QA_Sprite_C'].map((id) => ({ ...makeActor(), id, name: id }));
  manager.actors.push(...actors);
  const starts = [];
  manager.onStateChange = ({ type, actor }) => {
    if (type === 'playing') starts.push({ id: actor.id, elapsed: Date.now() });
  };
  const advanced = new Set();

  const timeline = new TimelineManager({ spriteAnimationManager: manager });
  timeline.setPlayMode('scheduled');
  timeline.steps = actors.map((actor, index) => ({
    id: `sprite-step-${index}`,
    type: ACTION_TYPES.PLAY_SPRITE_ANIMATION,
    actorId: actor.id,
    startAt: index * 0.04,
    duration: 0.16 - index * 0.02,
    data: { fps: 60, loop: true },
  }));

  const ticker = setInterval(() => {
    manager.update(0.02);
    for (const actor of actors) if (actor.frame > 0) advanced.add(actor.id);
  }, 5);
  try {
    assert.equal(await timeline.play(), true);
  } finally {
    clearInterval(ticker);
  }

  assert.deepEqual(starts.map(({ id }) => id), ['QA_Sprite_A', 'QA_Sprite_B', 'QA_Sprite_C']);
  assert.ok(starts[1].elapsed - starts[0].elapsed >= 20, 'second sprite starts after the first scheduled offset');
  assert.ok(starts[2].elapsed - starts[1].elapsed >= 20, 'third sprite starts after the second scheduled offset');
  assert.deepEqual([...advanced].sort(), actors.map((actor) => actor.id).sort(), 'every sprite advanced through its frames');
  assert.ok(actors.every((actor) => actor.frame >= 0 && actor.frame < actor.frameCount), 'looping keeps frames inside the 8-frame sheet');
  assert.ok(actors.every((actor) => !actor.isPlaying), 'all timed sprite actions completed');
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
  assert.deepEqual([actor.x, actor.y, actor.displayHeight], [360, 40, 80]);
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

test('project sprite manifest rejects duplicate or missing IDs before touching the scene', () => {
  const asset = { id: 'sprite-1', data: 'AQID' };
  assert.deepEqual(
    [...SpriteAnimationManager.validateProjectAssets([asset])],
    ['sprite-1'],
  );
  assert.throws(
    () => SpriteAnimationManager.validateProjectAssets([asset, { ...asset }]),
    /yinelenen spritesheet kimliği/i,
  );
  assert.throws(
    () => SpriteAnimationManager.validateProjectAssets([{ data: 'AQID' }]),
    /kimliği geçersiz/i,
  );
});

test('sprite positions remain visible after a viewport shrinks or changes orientation', () => {
  const manager = new SpriteAnimationManager(new THREE.Scene(), { width: 400, height: 300 });
  const actor = makeActor();
  actor.frameWidth = 32;
  actor.frameHeight = 32;
  actor.x = 380;
  actor.y = 270;
  manager.actors.push(actor);

  manager.resize(120, 80);
  assert.ok(actor.x - actor.displayHeight / 2 >= 0);
  assert.ok(actor.x + actor.displayHeight / 2 <= 120);
  assert.ok(actor.y - actor.displayHeight / 2 >= 0);
  assert.ok(actor.y + actor.displayHeight / 2 <= 80);
  manager.setTransform(actor.id, { x: 8, y: 8 });
  assert.ok(actor.x - actor.displayHeight / 2 >= 0, 'sprite can be dragged back from a resized edge');
  assert.ok(actor.y - actor.displayHeight / 2 >= 0);
});

test('sprites remain fully visible and proportionally scaled on target phone viewports', () => {
  const manager = new SpriteAnimationManager(new THREE.Scene(), { width: 800, height: 600 });
  const actor = makeActor();
  actor.frameWidth = 64;
  actor.frameHeight = 32;
  actor.x = 790;
  actor.y = 590;
  actor.displayHeight = 120;
  manager.actors.push(actor);
  for (const [width, height] of [[320, 568], [360, 640], [844, 390]]) {
    manager.resize(width, height);
    const spriteWidth = actor.displayHeight * 2;
    assert.ok(actor.x - spriteWidth / 2 >= -1e-6, `${width}x${height}: left edge`);
    assert.ok(actor.x + spriteWidth / 2 <= width + 1e-6, `${width}x${height}: right edge`);
    assert.ok(actor.y - actor.displayHeight / 2 >= -1e-6, `${width}x${height}: top edge`);
    assert.ok(actor.y + actor.displayHeight / 2 <= height + 1e-6, `${width}x${height}: bottom edge`);
    manager.setTransform(actor.id, { x: width / 2, y: height / 2 });
    assert.equal(actor.x, width / 2);
    assert.equal(actor.y, height / 2);
    assert.ok(actor.x - actor.displayHeight >= -1e-6);
    assert.ok(actor.x + actor.displayHeight <= width + 1e-6);
  }
});
