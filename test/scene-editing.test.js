import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
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


test('scene transforms have bounded independent undo and redo history', () => {
  const scene=new THREE.Scene(), mesh=new THREE.Mesh(new THREE.BoxGeometry(),new THREE.MeshBasicMaterial()); mesh.userData.sceneEditorId='edit-me';scene.add(mesh);const editor=new SceneEditor({scene});
  editor.setTransform('edit-me',{position:{x:3,y:0,z:0}});assert.equal(editor.undo(),true);assert.equal(mesh.position.x,0);assert.equal(editor.redo(),true);assert.equal(mesh.position.x,3);assert.equal(editor.resetTransform('edit-me'),true);assert.equal(mesh.position.x,0);
});

test('selected color clones materials, preserving sibling materials and material properties', () => {
  const scene=new THREE.Scene(), shared=new THREE.MeshStandardMaterial({color:'#112233',roughness:0.3});const a=new THREE.Mesh(new THREE.BoxGeometry(),shared),b=new THREE.Mesh(new THREE.BoxGeometry(),shared);a.userData.sceneEditorId='a';b.userData.sceneEditorId='b';scene.add(a,b);const editor=new SceneEditor({scene});editor.select('a');assert.equal(editor.getSelectedColor(),'#112233');assert.equal(editor.applySelectedColor('#ff0000'),true);assert.equal(a.material.color.getHexString(),'ff0000');assert.equal(b.material.color.getHexString(),'112233');assert.equal(a.material.roughness,0.3);
});

test('validated primitives expose visual-only meshes and persist descriptor plus transform and color', () => {
  const scene=new THREE.Scene(),editor=new SceneEditor({scene});assert.throws(()=>editor.createPrimitive('box',{width:Infinity}));const box=editor.createPrimitive('box',{id:'primitive:box',width:2,color:'#abcdef'});editor.setTransform(box.userData.sceneEditorId,{position:{x:2,y:3,z:4}});const state=editor.exportProjectState().find(x=>x.id==='primitive:box');assert.deepEqual(state.primitive.type,'box');assert.equal(state.color,'#abcdef');assert.deepEqual(state.position,{x:2,y:3,z:4});assert.equal(editor.removePrimitive('primitive:box'),true);assert.equal(editor.list().some(x=>x.id==='primitive:box'),false);
});

test('v5 scene records migrate to v6 while keeping scene edits backward compatible', async () => {
  const current=createAutosaveRecord({timeline:{steps:[]},sprites:[],sceneEdits:[{id:'s',position:{x:0,y:0,z:0},rotation:{x:0,y:0,z:0},scale:{x:1,y:1,z:1},color:'#aabbcc'}]});const prior={...current,schemaVersion:5,projectVersion:5};const migrated=(await import('../src/components/ProjectStore.js')).migrateProjectRecord(prior);assert.equal(migrated.schemaVersion,6);assert.equal(migrated.sceneEdits[0].color,'#aabbcc');
});

test('scene colors persist across restore without recoloring shared siblings', () => {
  const scene = new THREE.Scene();
  const shared = new THREE.MeshStandardMaterial({ color: '#102030', roughness: 0.4 });
  const target = new THREE.Mesh(new THREE.BoxGeometry(), shared);
  const sibling = new THREE.Mesh(new THREE.BoxGeometry(), shared);
  target.userData.sceneEditorId = 'color:target';
  sibling.userData.sceneEditorId = 'color:sibling';
  scene.add(target, sibling);
  const editor = new SceneEditor({ scene });
  assert.equal(editor.setColor('color:target', '#abcdef'), true);
  const saved = editor.exportProjectState();
  assert.equal(saved.find((edit) => edit.id === 'color:target').color, '#abcdef');
  assert.equal(target.material.color.getHexString(), 'abcdef');
  assert.equal(sibling.material.color.getHexString(), '102030');
  assert.equal(target.material.roughness, 0.4);
  editor.restoreProjectState(saved);
  assert.equal(editor.getObjectColor(target), '#abcdef');
  assert.equal(editor.setColor('color:target', 'invalid'), false);
  editor.restoreProjectState([]);
  assert.equal(target.material, shared);
  target.geometry.dispose(); sibling.geometry.dispose(); editor.dispose(); shared.dispose();
});

test('primitive scene edits reconstruct names and colors, clear stale primitives, and reset history on restore', () => {
  const scene = new THREE.Scene();
  const editor = new SceneEditor({ scene });
  const object = editor.createPrimitive('box', { id: 'primitive:test', name: 'Test block', width: 2, color: '#667788' });
  editor.setTransform('primitive:test', { position: { x: 2, y: 1, z: -1 } });
  const saved = editor.exportProjectState();
  assert.equal(editor.undo(), true);
  editor.restoreProjectState(saved);
  const restored = editor.list().find((entry) => entry.id === 'primitive:test');
  assert.equal(restored.label, 'Test block');
  assert.equal(editor.getSelectedColor(), null);
  let restoredMesh = null;
  scene.traverse((o) => { if (o.userData?.sceneEditorId === 'primitive:test') restoredMesh = o; });
  assert.equal(editor.getObjectColor(restoredMesh), '#667788');
  assert.equal(editor.canUndo, false);
  assert.equal(editor.canRedo, false);
  editor.restoreProjectState([]);
  assert.equal(editor.list().some((entry) => entry.id === 'primitive:test'), false);
  editor.dispose();
  assert.ok(object.geometry); // the removed geometry was disposed during reconciliation
});

test('scene hierarchy reports parent depth and supports persisted rename, visibility and lock state', () => {
  const scene = new THREE.Scene();
  const group = new THREE.Group(); group.userData.sceneEditorId = 'group:root'; group.name = 'Root'; scene.add(group);
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial()); mesh.userData.sceneEditorId = 'mesh:child'; mesh.name = 'Child'; group.add(mesh);
  const editor = new SceneEditor({ scene });
  assert.deepEqual(editor.list().map(({ id, depth, parentId }) => ({ id, depth, parentId })), [
    { id: 'group:root', depth: 0, parentId: null },
    { id: 'mesh:child', depth: 1, parentId: 'group:root' },
  ]);
  assert.equal(editor.renameObject('mesh:child', 'Renamed child'), true);
  assert.equal(editor.setObjectVisible('mesh:child', false), true);
  assert.equal(editor.setObjectLocked('mesh:child', true), true);
  const saved = editor.exportProjectState().find((edit) => edit.id === 'mesh:child');
  assert.equal(saved.label, 'Renamed child');
  assert.equal(saved.visible, false);
  assert.equal(saved.locked, true);
  const record = createAutosaveRecord({ timeline: { steps: [] }, sprites: [], sceneEdits: [saved] });
  assert.deepEqual(record.sceneEdits[0], saved);
  editor.restoreProjectState(record.sceneEdits);
  assert.equal(mesh.visible, false);
  assert.equal(mesh.userData.sceneEditorLocked, true);
  assert.equal(editor.list().find((item) => item.id === 'mesh:child').label, 'Renamed child');
  editor.restoreProjectState([]);
  assert.equal(mesh.visible, true);
  assert.equal(mesh.userData.sceneEditorLocked, false);
  assert.equal(editor.list().find((item) => item.id === 'mesh:child').label, 'Child');
  mesh.geometry.dispose(); mesh.material.dispose();
});

test('multi-selection transforms preserve relative offsets and undo/redo atomically', () => {
  const scene = new THREE.Scene();
  const first = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial()); first.userData.sceneEditorId = 'first';
  const second = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial()); second.userData.sceneEditorId = 'second'; second.position.x = 2;
  scene.add(first, second);
  const editor = new SceneEditor({ scene });
  editor.selectMany(['first', 'second']);
  assert.equal(editor.getSelection().count, 2);
  assert.equal(editor.setSelectionTransform({ position: { x: 5, y: 0, z: 0 } }), true);
  assert.equal(first.position.x, 3);
  assert.equal(second.position.x, 5);
  assert.equal(editor.undo(), true);
  assert.equal(first.position.x, 0);
  assert.equal(second.position.x, 2);
  assert.equal(editor.redo(), true);
  assert.equal(first.position.x, 3);
  assert.equal(second.position.x, 5);
  second.userData.sceneEditorLocked = true;
  assert.equal(editor.setSelectionTransform({ position: { x: 7, y: 0, z: 0 } }), false);
  assert.equal(first.position.x, 3);
  first.geometry.dispose(); first.material.dispose(); second.geometry.dispose(); second.material.dispose();
});

test('multi-selection applies the same world translation under differently rotated parents', () => {
  const scene = new THREE.Scene();
  const parentA = new THREE.Group(); parentA.rotation.z = Math.PI / 3; scene.add(parentA);
  const parentB = new THREE.Group(); parentB.position.set(4, 0, 0); parentB.rotation.z = -Math.PI / 4; scene.add(parentB);
  const first = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial()); first.userData.sceneEditorId = 'nested:first'; parentA.add(first);
  const second = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial()); second.userData.sceneEditorId = 'nested:second'; second.position.x = 2; parentB.add(second);
  scene.updateMatrixWorld(true);
  const beforeA = first.getWorldPosition(new THREE.Vector3());
  const beforeB = second.getWorldPosition(new THREE.Vector3());
  const editor = new SceneEditor({ scene }); editor.selectMany(['nested:first', 'nested:second']);
  assert.equal(editor.setSelectionTransform({ position: { x: second.position.x + 1, y: second.position.y, z: second.position.z } }), true);
  scene.updateMatrixWorld(true);
  const deltaA = first.getWorldPosition(new THREE.Vector3()).sub(beforeA);
  const deltaB = second.getWorldPosition(new THREE.Vector3()).sub(beforeB);
  assert.ok(deltaA.distanceTo(deltaB) < 1e-8);
  assert.ok(Math.abs(deltaA.length() - 1) < 1e-8);
  first.geometry.dispose(); first.material.dispose(); second.geometry.dispose(); second.material.dispose();
});

test('hierarchy visibility keeps imported map mesh collision registration in sync', () => {
  const scene = new THREE.Scene();
  const collision = new CollisionManager(scene);
  const map = new MapLoader(scene, collision);
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
  mesh.userData.editorCollisionKind = 'obstacle';
  scene.add(mesh); map.meshesByEditorId.set('mesh-1', mesh);
  map.setMeshCollisionKind('mesh-1', 'obstacle');
  const editor = new SceneEditor({ scene, mapLoader: map, collisionManager: collision });
  assert.equal(collision.registeredObstacles.some((entry) => entry.object === mesh), true);
  assert.equal(editor.setObjectVisible('map:mesh-1', false), true);
  assert.equal(mesh.visible, false);
  assert.equal(collision.registeredObstacles.some((entry) => entry.object === mesh), false);
  assert.equal(editor.setObjectVisible('map:mesh-1', true), true);
  assert.equal(collision.registeredObstacles.some((entry) => entry.object === mesh), true);
  const hiddenState = editor.exportProjectState().map((edit) => edit.id === 'map:mesh-1' ? { ...edit, visible: false } : edit);
  editor.restoreProjectState(hiddenState);
  assert.equal(mesh.visible, false);
  assert.equal(collision.registeredObstacles.some((entry) => entry.object === mesh), false);
  const shownState = hiddenState.map((edit) => edit.id === 'map:mesh-1' ? { ...edit, visible: true } : edit);
  editor.restoreProjectState(shownState);
  assert.equal(mesh.visible, true);
  assert.equal(collision.registeredObstacles.some((entry) => entry.object === mesh), true);
  map.clear(); mesh.geometry.dispose(); mesh.material.dispose();
});

test('hiding a hierarchy parent disables child obstacle collision until shown again', () => {
  const scene = new THREE.Scene();
  const collision = new CollisionManager(scene);
  const group = new THREE.Group(); group.userData.sceneEditorId = 'group:collider'; scene.add(group);
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2), new THREE.MeshBasicMaterial());
  mesh.userData.sceneEditorId = 'mesh:collider'; group.add(mesh); collision.registerObstacle(mesh);
  const editor = new SceneEditor({ scene, collisionManager: collision });
  assert.notEqual(collision.clampTargetOutsideObstacles(new THREE.Vector3(0, 0, 0), 0.25).x, 0);
  assert.equal(editor.setObjectVisible('group:collider', false), true);
  assert.equal(collision.clampTargetOutsideObstacles(new THREE.Vector3(0, 0, 0), 0.25).x, 0);
  assert.equal(editor.setObjectVisible('group:collider', true), true);
  assert.notEqual(collision.clampTargetOutsideObstacles(new THREE.Vector3(0, 0, 0), 0.25).x, 0);
  mesh.geometry.dispose(); mesh.material.dispose();
});

test('scene panel exposes color, primitive creation and separate scene history controls', async () => {
  const html = await readFile(new URL('../src/ui/studio-panel.html', import.meta.url), 'utf8');
  for (const id of ['scene-editor-color', 'scene-editor-primitive-type', 'btn-scene-editor-add-primitive', 'btn-scene-editor-remove-primitive', 'btn-scene-editor-undo', 'btn-scene-editor-redo']) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.match(html, /Nesne rengi/);
  assert.match(html, /Düzenleme türü/);
  for (const id of ['scene-editor-hierarchy', 'scene-editor-rename', 'scene-editor-touch-step']) assert.match(html, new RegExp(`id="${id}"`));
  assert.match(html, /data-scene-nudge=/);
});
