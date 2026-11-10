import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const home = await readFile(new URL('../src/components/HomeScreen.js', import.meta.url), 'utf8');
const css = await readFile(new URL('../src/style.css', import.meta.url), 'utf8');

test('Home library tabs have roving tabindex, linked panel, and arrow/Home/End navigation', () => {
  assert.match(html, /id="home-library-tab-3d"[^>]*aria-controls="home-character-list"[^>]*tabindex="0"/);
  assert.match(html, /id="home-library-tab-2d"[^>]*aria-controls="home-character-list"[^>]*tabindex="-1"/);
  assert.match(html, /id="home-character-list"[^>]*role="tabpanel"[^>]*aria-labelledby="home-library-tab-3d"/);
  assert.match(home, /event\.key === 'ArrowRight'/);
  assert.match(home, /event\.key === 'ArrowLeft'/);
  assert.match(home, /event\.key === 'Home'/);
  assert.match(home, /event\.key === 'End'/);
  assert.match(home, /button\.tabIndex = active \? 0 : -1/);
  assert.match(home, /setAttribute\('aria-labelledby', `home-library-tab-\$\{this\.activeKind\}`\)/);
});

test('Home dialog labels its title and description and announces/focuses errors inside the dialog', () => {
  assert.match(html, /<dialog id="home-dialog"[^>]*aria-labelledby="home-dialog-title"[^>]*aria-describedby="home-dialog-message"/);
  assert.match(html, /id="home-dialog-error"[^>]*role="alert"[^>]*tabindex="-1"[^>]*hidden/);
  assert.match(home, /this\.dom\.dialogError\.textContent = error\.message/);
  assert.match(home, /this\.dom\.dialogError\.focus\(\)/);
});

test('Home interactions have 44px hit areas and studio tablet sizing is coarse-pointer-only', () => {
  assert.match(css, /\.home-primary-button, \.home-small-button\s*\{[^}]*min-height:\s*44px/s);
  assert.match(css, /@media \(max-width: 560px\)[\s\S]*?\.home-primary-button\s*\{\s*min-height:\s*44px/);
  assert.match(css, /\.home-project-actions button\s*\{[^}]*min-height:\s*44px/s);
  assert.match(css, /\.home-library-tab\s*\{[^}]*min-height:\s*44px/s);
  assert.match(css, /\.home-character-actions button\s*\{[^}]*min-height:\s*44px/s);
  assert.match(css, /@media \(pointer: coarse\) and \(min-width: 768px\) and \(max-width: 1024px\)/);
  assert.match(css, /\.studio-panel button, \.studio-panel select[^\{]*\{[^}]*min-height: 44px/s);
});
