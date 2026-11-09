import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../src/style.css', import.meta.url), 'utf8');
const mobileOverrides = css.split('/* Consistent mobile hit areas for every actionable control inside studio panels. */')[1];
assert.ok(mobileOverrides, 'expected dedicated mobile touch-target overrides');

function declarationsFor(selector) {
  const rule = [...mobileOverrides.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .find(([, selectors]) => selectors.split(',').some((item) => item.trim() === selector));
  assert.ok(rule, `expected ${selector} to have a mobile override`);
  return rule[2];
}

test('studio panel buttons have 44px minimum hit areas on mobile', () => {
  const declarations = declarationsFor('.studio-panel button');
  assert.match(declarations, /min-width:\s*44px/);
  assert.match(declarations, /min-height:\s*44px/);
  assert.match(declarationsFor('.studio-panel .hud-btn.small-btn'), /min-height:\s*44px/);
});

test('dense mobile action groups can wrap without widening the document', () => {
  assert.match(declarationsFor('.step-actions'), /flex-wrap:\s*wrap/);
  assert.match(declarationsFor('.step-btn-icon'), /width:\s*44px/);
  assert.match(declarationsFor('.step-btn-icon'), /height:\s*44px/);
  assert.match(declarationsFor('.scene-editor-tree-row'), /min-width:\s*0/);
  assert.match(declarationsFor('.scene-editor-tree-row'), /grid-template-columns:[^;]*44px/);
  assert.match(declarationsFor('html'), /overflow-x:\s*hidden/);
});
