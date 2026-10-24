import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const files = await Promise.all([
  readFile(new URL('../src/ui/studio-panel.html', import.meta.url), 'utf8'),
  readFile(new URL('../src/components/UIManager.js', import.meta.url), 'utf8'),
  readFile(new URL('../src/main.js', import.meta.url), 'utf8'),
]);
const [panel, uiManager, main] = files;

const controlIds = [
  'file-picker-world-sprite', 'world-sprite-name', 'world-sprite-columns', 'world-sprite-rows', 'world-sprite-fps',
  'btn-save-world-sprite-template', 'world-sprite-template-select', 'btn-spawn-world-sprite',
  'btn-delete-world-sprite-template', 'world-sprite-actor-select', 'btn-world-sprite-control', 'btn-remove-world-sprite',
];

test('world-space 2D character library exposes all upload, reuse, spawn and movement controls', () => {
  for (const id of controlIds) {
    assert.match(panel, new RegExp(`id="${id}"`), `missing panel control ${id}`);
    assert.match(uiManager, new RegExp(`getElementById\\('${id}'\\)`), `UIManager does not cache ${id}`);
  }
});

test('the app loads the persistent world-character library, updates it and routes tap movement', () => {
  assert.match(main, /new WorldSpriteCharacterManager\(this\.scene, this\.collisionManager/);
  assert.match(main, /worldSpriteCharacterManager\.loadLibrary\(\)/);
  assert.match(main, /worldSpriteCharacterManager\.update\(delta\)/);
  assert.match(main, /worldSpriteCharacterManager\.moveSelectedTo\(targetPoint\)/);
  assert.match(main, /intersectObjects\(this\.worldSpriteCharacterManager\.actors\.map/);
});
