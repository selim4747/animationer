import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Character } from '../src/components/Character.js';
import { CharacterRoster } from '../src/components/CharacterRoster.js';
import { ACTION_TYPES, TimelineManager } from '../src/components/TimelineManager.js';

const closeTo = (actual, expected, epsilon = 0.05) => assert.ok(Math.abs(actual - expected) <= epsilon, `${actual} is not within ${epsilon} of ${expected}`);

test('roster adds/selects/removes actors and routes controls only to the selected actor', () => {
  const scene = new THREE.Scene();
  const roster = new CharacterRoster(scene, null);
  const first = roster.getCharacter();
  const second = roster.addCharacter('Karakter 2');

  assert.equal(roster.list().length, 2);
  assert.equal(roster.select(second.id), true);
  second.character.setSpeed(2);
  roster.setControlVector(1, 0);
  roster.update(0.25);
  closeTo(second.character.getPosition().x, 1.35 + 0.5);
  closeTo(first.getPosition().x, 0);

  assert.equal(roster.removeCharacter(second.id), true);
  assert.equal(roster.list().length, 1);
  assert.equal(roster.removeCharacter(first.rootGroup.name), false, 'cannot remove the final character');
});

test('continuous controls stop in place and duration-based moves arrive on the requested duration', async () => {
  const actor = new Character(new THREE.Scene());
  actor.setSpeed(2);
  actor.setControlVector(1, 0);
  actor.update(0.25);
  closeTo(actor.getPosition().x, 0.5);
  actor.setControlVector(0, 0);
  actor.update(0.2);
  closeTo(actor.getPosition().x, 0.5);

  const move = actor.moveToPromise(new THREE.Vector3(4.5, 0, 0), { duration: 2 });
  for (let i = 0; i < 20; i++) actor.update(0.1);
  actor.update(0.1);
  assert.equal(await move, true);
  closeTo(actor.getPosition().x, 4.5);
});

test('scheduled timeline launches same-time actors concurrently and imports timing metadata safely', async () => {
  const timeline = new TimelineManager({});
  timeline.clear();
  timeline.setPlayMode('scheduled');
  timeline.steps = [
    { type: ACTION_TYPES.WAIT, title: 'A', data: { duration: 0.1 }, startAt: 0, duration: 0.1 },
    { type: ACTION_TYPES.WAIT, title: 'B', data: { duration: 0.1 }, startAt: 0, duration: 0.1 },
  ];
  let active = 0;
  let maxActive = 0;
  timeline._executeStep = async () => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    await new Promise((resolve) => setTimeout(resolve, 90));
    active -= 1;
  };
  assert.equal(await timeline.play(), true);
  assert.equal(maxActive, 2);

  timeline.importSequence({ playMode: 'scheduled', steps: [
    { type: ACTION_TYPES.FOLLOW, title: 'Follow', actorId: 'character-2', startAt: 5, duration: 25,
      data: { targetCharacterId: 'character-1', offset: { x: 0, y: 0, z: 1.2 } } },
    { type: ACTION_TYPES.SET_VISIBILITY, actorId: 'character-2', startAt: 30,
      data: { visible: false } },
  ] });
  assert.equal(timeline.steps[0].actorId, 'character-2');
  assert.equal(timeline.steps[0].startAt, 5);
  assert.equal(timeline.steps[0].duration, 25);
  assert.equal(timeline.steps[1].data.visible, false);
  assert.equal(JSON.parse(timeline.exportSequence()).playMode, 'scheduled');
  assert.throws(() => timeline.importSequence({ steps: [
    { type: ACTION_TYPES.FOLLOW, data: { targetCharacterId: '', offset: {} } },
  ] }));
  assert.throws(() => timeline.importSequence({ steps: [
    { type: ACTION_TYPES.WAIT, data: { duration: 1 }, startAt: -1 },
  ] }));
});

test('stopping and immediately restarting scheduled playback does not revive the old schedule', async () => {
  const timeline = new TimelineManager({});
  timeline.setPlayMode('scheduled');
  timeline.steps = [{ type: ACTION_TYPES.WAIT, data: { duration: 1 }, startAt: 10 }];
  const oldPlayback = timeline.play();
  await new Promise((resolve) => setTimeout(resolve, 25));
  timeline.stop();

  let runs = 0;
  timeline.steps = [{ type: ACTION_TYPES.WAIT, data: { duration: 0.1 }, startAt: 0 }];
  timeline._executeStep = async () => { runs += 1; };
  assert.equal(await timeline.play(), true);
  assert.equal(await oldPlayback, false);
  assert.equal(runs, 1);
  assert.equal(timeline.isPlaying, false);
});

test('scheduled playback does not dispatch while paused during a timing wait', async () => {
  const timeline = new TimelineManager({});
  timeline.setPlayMode('scheduled');
  timeline.steps = [{ type: ACTION_TYPES.WAIT, data: { duration: 0.01 }, startAt: 0.12 }];
  let runs = 0;
  timeline._executeStep = async () => { runs += 1; };
  const playback = timeline.play();
  await new Promise((resolve) => setTimeout(resolve, 25));
  timeline.pause();
  await new Promise((resolve) => setTimeout(resolve, 160));
  assert.equal(runs, 0);
  await timeline.play();
  assert.equal(await playback, true);
  assert.equal(runs, 1);
});

test('scheduled playback holds later dispatches while paused between actions', async () => {
  const timeline = new TimelineManager({});
  timeline.setPlayMode('scheduled');
  timeline.steps = [
    { type: ACTION_TYPES.WAIT, data: { duration: 0.01 }, startAt: 0 },
    { type: ACTION_TYPES.WAIT, data: { duration: 0.01 }, startAt: 0.16 },
  ];
  const starts = [];
  let markFirstStarted;
  const firstStarted = new Promise((resolve) => { markFirstStarted = resolve; });
  timeline._executeStep = async (step) => { starts.push(step); if (starts.length === 1) markFirstStarted(); };
  const playback = timeline.play();
  await firstStarted;
  timeline.pause();
  await new Promise((resolve) => setTimeout(resolve, 180));
  assert.equal(starts.length, 1);
  await timeline.play();
  assert.equal(await playback, true);
  assert.equal(starts.length, 2);
});

test('stop aborts an active scheduled wait before immediate restart', async () => {
  const timeline = new TimelineManager({});
  timeline.setPlayMode('scheduled');
  timeline.steps = [{ type: ACTION_TYPES.WAIT, data: { duration: 10 }, startAt: 0 }];
  const oldPlayback = timeline.play();
  await new Promise((resolve) => setTimeout(resolve, 30));
  timeline.stop();
  timeline.steps = [{ type: ACTION_TYPES.WAIT, data: { duration: 0.01 }, startAt: 0 }];
  let runs = 0;
  timeline._executeStep = async () => { runs += 1; };
  assert.equal(await timeline.play(), true);
  assert.equal(await oldPlayback, false);
  assert.equal(runs, 1);
});

test('character accepts an imported model and plays a matching locomotion clip', () => {
  const character = new Character(new THREE.Scene());
  const model = new THREE.Group();
  model.add(new THREE.Mesh(new THREE.BoxGeometry(1, 2, 1), new THREE.MeshStandardMaterial()));
  const walkClip = new THREE.AnimationClip('Walk', 1, [
    new THREE.NumberKeyframeTrack('.position[y]', [0, 1], [0, 0.1]),
  ]);

  character.setModel(model, [walkClip]);
  assert.equal(character.bodyMesh.parent, null);
  assert.equal(model.parent, character.visualGroup);
  closeTo(model.scale.y, 0.8);
  character.setControlVector(1, 0);
  character.update(0.1);
  assert.equal(character.walkAction.isRunning(), true);
  character.setControlVector(0, 0);
  character.update(0.2);
  assert.equal(character.animationState, 'idle');
});

test('roster loads a GLB file as a selected character', async () => {
  const positions = Buffer.from(new Float32Array([0, 0, 0, 0, 2, 0, 1, 0, 0]).buffer);
  const gltfJson = {
    asset: { version: '2.0' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
    buffers: [{ byteLength: positions.length }],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: positions.length, target: 34962 }],
    accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min: [0, 0, 0], max: [1, 2, 0] }],
  };
  const jsonBytesRaw = Buffer.from(JSON.stringify(gltfJson));
  const jsonBytes = Buffer.concat([jsonBytesRaw, Buffer.alloc((4 - (jsonBytesRaw.length % 4)) % 4, 0x20)]);
  const jsonHeader = Buffer.alloc(8);
  jsonHeader.writeUInt32LE(jsonBytes.length, 0);
  jsonHeader.writeUInt32LE(0x4e4f534a, 4);
  const binHeader = Buffer.alloc(8);
  binHeader.writeUInt32LE(positions.length, 0);
  binHeader.writeUInt32LE(0x004e4942, 4);
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + jsonHeader.length + jsonBytes.length + binHeader.length + positions.length, 8);
  const file = new File([header, jsonHeader, jsonBytes, binHeader, positions], 'visitor.glb', { type: 'model/gltf-binary' });

  const scene = new THREE.Scene();
  const roster = new CharacterRoster(scene, null);
  const actor = await roster.loadCharacterFile(file);
  assert.equal(actor.name, 'visitor');
  assert.equal(roster.selectedId, actor.id);
  assert.equal(actor.character.modelRoot.parent, actor.character.visualGroup);
  assert.equal(roster.list().length, 2);
});
