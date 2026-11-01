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

test('scene panel exposes color, primitive creation and separate scene history controls', async () => {
  const html = await readFile(new URL('../src/ui/studio-panel.html', import.meta.url), 'utf8');
  for (const id of ['scene-editor-color', 'scene-editor-primitive-type', 'btn-scene-editor-add-primitive', 'btn-scene-editor-remove-primitive', 'btn-scene-editor-undo', 'btn-scene-editor-redo']) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.match(html, /Nesne rengi/);
  assert.match(html, /Düzenleme türü/);
});
