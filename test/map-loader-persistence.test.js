import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { MapLoader } from '../src/components/MapLoader.js';
import { parseImageDimensions } from '../src/utils/image-dimensions.js';


function pngBlob(width = 64, height = 32, payload = []) {
  const bytes = new Uint8Array(24 + payload.length);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  bytes.set([0x49, 0x48, 0x44, 0x52], 12);
  bytes.set([(width >>> 24) & 255, (width >>> 16) & 255, (width >>> 8) & 255, width & 255], 16);
  bytes.set([(height >>> 24) & 255, (height >>> 16) & 255, (height >>> 8) & 255, height & 255], 20);
  bytes.set(payload, 24);
  return new Blob([bytes], { type: 'image/png' });
}

function makeLoader() {
  const scene = new THREE.Scene();
  const statuses = [];
  const changes = [];
  const loader = new MapLoader(scene, null, (status) => statuses.push(status), (change) => changes.push(change));
  loader.textureLoader = { async loadAsync() { return new THREE.Texture({ width: 64, height: 32 }); } };
  return { loader, scene, statuses, changes };
}

test('2D environment retains its source Blob and round-trips orientation, scale and opacity', async () => {
  const { loader, scene, changes } = makeLoader();
  const source = pngBlob();
  await loader.loadImage('blob:floor', 'floor.png', source);
  loader.setScale(12);
  loader.setOpacity(0.6);
  loader.setOrientation(false);
  const state = loader.exportStateForStorage();
  assert.equal(state.fileName, 'floor.png');
  assert.equal(state.blob.size, source.size);
  assert.equal(state.scale, 12);
  assert.equal(state.opacity, 0.6);
  assert.equal(state.groundOrientation, false);
  assert.ok(loader.stateRevision > 0);
  assert.ok(changes.length >= 4);
  assert.equal(scene.children.includes(loader.currentPlane), true);

  const restored = makeLoader().loader;
  restored.textureLoader = { async loadAsync() { return new THREE.Texture({ width: 64, height: 32 }); } };
  await restored.restoreProjectState(state);
  assert.equal(restored.currentObjectType, '2d');
  assert.equal(restored.currentScale, 12);
  assert.equal(restored.currentOpacity, 0.6);
  assert.equal(restored.isGroundOrientation, false);
  loader.clear();
  restored.clear();
});

test('failed replacement leaves the previous 2D environment and persistent source intact', async () => {
  const { loader, scene, statuses } = makeLoader();
  const source = pngBlob();
  await loader.loadImage('blob:old', 'old.png', source);
  const oldPlane = loader.currentPlane;
  const oldTexture = loader.currentTexture;
  loader.textureLoader = { async loadAsync() { throw new Error('decode failed'); } };
  await assert.rejects(loader.loadImage('blob:new', 'new.png', pngBlob()), /decode failed/);
  assert.equal(loader.currentPlane, oldPlane);
  assert.equal(loader.currentTexture, oldTexture);
  assert.equal(scene.children.includes(oldPlane), true);
  assert.equal(loader.exportStateForStorage().fileName, 'old.png');
  assert.equal(statuses.at(-1).type, 'error');
  loader.clear();
});

test('image headers are validated before texture decoding, including compact oversized PNGs', async () => {
  const { loader } = makeLoader();
  let decodeCalls = 0;
  loader.textureLoader = { async loadAsync() { decodeCalls++; return new THREE.Texture({ width: 1, height: 1 }); } };
  await assert.rejects(loader.loadImage('blob:oversized', 'huge.png', pngBlob(50000, 50000)), /çözünürlüğü/);
  assert.equal(decodeCalls, 0);
  await loader.loadImage('blob:valid', 'valid.png', pngBlob(64, 32));
  assert.equal(decodeCalls, 1);
  loader.clear();
});

test('.gltf upload is rejected with an actionable single-file .glb message', async () => {
  const { loader, statuses } = makeLoader();
  await assert.rejects(loader.handleFile(new File(['{}'], 'scene.gltf', { type: 'model/gltf+json' })), /\.glb/);
  assert.match(statuses.at(-1).message, /\.glb/);
});

test('failed GLB replacement preserves the active model', async () => {
  const { loader, scene, statuses } = makeLoader();
  const model = new THREE.Group();
  loader.gltfLoader = { load(url, onLoad, progress, onError) { if (url === 'blob:old') onLoad({ scene: model }); else onError(new Error('bad model')); } };
  await loader.loadGLTF('blob:old', 'old.glb', new Blob(['old']));
  await assert.rejects(loader.loadGLTF('blob:bad', 'bad.glb'), /bad model/);
  assert.equal(loader.currentLoadedObject, model);
  assert.equal(scene.children.includes(model), true);
  assert.equal(loader.currentFileName, 'old.glb');
  assert.equal(statuses.at(-1).type, 'error');
  loader.clear();
});

test('out-of-order GLB requests keep only the latest model and dispose the stale candidate', async () => {
  const { loader, scene } = makeLoader();
  const pending = new Map();
  loader.gltfLoader = { load(url, onLoad) { pending.set(url, onLoad); } };
  const firstPromise = loader.loadGLTF('blob:first', 'first.glb');
  const secondPromise = loader.loadGLTF('blob:second', 'second.glb');
  const makeModel = () => {
    const model = new THREE.Group();
    const geometry = new THREE.BoxGeometry(1, 1, 1);
    const material = new THREE.MeshBasicMaterial();
    let geometryDisposed = false;
    const originalDispose = geometry.dispose.bind(geometry);
    geometry.dispose = () => { geometryDisposed = true; originalDispose(); };
    model.add(new THREE.Mesh(geometry, material));
    return { model, geometry, material, wasDisposed: () => geometryDisposed };
  };
  const first = makeModel();
  const second = makeModel();
  pending.get('blob:second')({ scene: second.model });
  await secondPromise;
  pending.get('blob:first')({ scene: first.model });
  assert.equal(await firstPromise, null);
  assert.equal(loader.currentLoadedObject, second.model);
  assert.deepEqual(scene.children, [second.model]);
  assert.equal(first.wasDisposed(), true);
  loader.clear();
});


test('dimension parser reads valid JPEG and WebP headers', () => {
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x20, 0x00, 0x40, 0x03, 0x01, 0x11, 0x00, 0x02, 0x11, 0x00, 0x03, 0x11, 0x00]);
  assert.deepEqual(parseImageDimensions(jpeg), { width: 64, height: 32 });
  const webp = new Uint8Array(30);
  webp.set(Array.from('RIFF').map((c) => c.charCodeAt(0)), 0);
  webp.set(Array.from('WEBPVP8X').map((c) => c.charCodeAt(0)), 8);
  webp[16] = 10;
  webp[24] = 63; // width - 1 = 63
  webp[27] = 31; // height - 1 = 31
  assert.deepEqual(parseImageDimensions(webp), { width: 64, height: 32 });
});
