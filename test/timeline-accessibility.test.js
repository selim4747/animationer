import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const uiSource = await readFile(new URL('../src/components/UIManager.js', import.meta.url), 'utf8');
const cssSource = await readFile(new URL('../src/style.css', import.meta.url), 'utf8');

test('timeline action is a named native button with a visible keyboard focus style', () => {
  assert.match(uiSource, /<button type="button" class="step-run-button">/);
  assert.match(uiSource, /runButton\.setAttribute\('aria-label', `Çalıştır:/);
  assert.match(cssSource, /\.step-run-button:focus-visible\s*\{[^}]*outline:\s*2px solid/s);
});

test('reorder, delete and inline editor controls are siblings of the run button and isolate clicks', () => {
  const cardMarkup = uiSource.match(/item\.innerHTML = `([\s\S]*?)`;/)?.[1] || '';
  assert.match(cardMarkup, /<\/button>\s*<\/div>\s*<div class="step-actions">/);
  assert.match(cardMarkup, /class="[^"]*btn-step-up"/);
  assert.match(cardMarkup, /class="[^"]*btn-step-down"/);
  assert.match(cardMarkup, /class="[^"]*btn-step-delete"/);
  assert.match(uiSource, /control\.addEventListener\('click', \(event\) => event\.stopPropagation\(\)\)/);
  assert.match(uiSource, /item\.querySelector\('\.btn-step-delete'\)\.addEventListener\('click', \(e\) => \{\s*e\.stopPropagation\(\)/);
});
