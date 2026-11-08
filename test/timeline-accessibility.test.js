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

test('studio tabs expose tab semantics and keyboard roving navigation', async () => {
  const html = await readFile(new URL('../src/ui/studio-panel.html', import.meta.url), 'utf8');
  assert.equal((html.match(/role="tab"/g) || []).length, 7);
  assert.equal((html.match(/role="tabpanel"/g) || []).length, 7);
  assert.match(html, /id="studio-tab-performance-tab" role="tab" aria-controls="tab-performance"/);
  assert.match(html, /id="tab-performance" class="studio-tab-pane" role="tabpanel" aria-labelledby="studio-tab-performance-tab"/);
  assert.match(html, /role="tablist"/);
  assert.match(uiSource, /event\.key === 'ArrowRight'/);
  assert.match(uiSource, /event\.key === 'Home'/);
  assert.match(uiSource, /aria-selected/);
});

test('global shortcuts ignore editable and interactive targets, composition, and modifiers', () => {
  assert.match(uiSource, /e\.isComposing \|\| e\.ctrlKey \|\| e\.metaKey \|\| e\.altKey/);
  assert.match(uiSource, /target\?\.closest\?\.\('[^']*button/);
  assert.match(uiSource, /e\.preventDefault\(\)/);
});

test('timeline alternate ruler and per-step character assignments are present and derived', () => {
  assert.match(uiSource, /timeline\.steps\.forEach/);
  assert.match(uiSource, /this\.timeline\.updateStep\(idx, patch/);
  assert.match(uiSource, /Karakter \(boş = seçili karakter\)/);
  assert.match(uiSource, /timeline\.isPlaying\) return/);
  assert.match(cssSource, /\.timeline-ruler-step:focus-visible/);
});
