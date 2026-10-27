import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { loadImage } from '../src/utils/load-image.js';

class FakeImage {
  set src(value) {
    this.source = value;
    queueMicrotask(() => {
      if (value === 'broken') this.onerror?.(new Event('error'));
      else {
        this.naturalWidth = 4;
        this.naturalHeight = 2;
        this.onload?.(new Event('load'));
      }
    });
  }
}

test('image loading resolves on the standard load event without relying on Image.decode()', async () => {
  const image = await loadImage('blob:valid', FakeImage);
  assert.equal(image.source, 'blob:valid');
  assert.equal(image.naturalWidth, 4);
  assert.equal(image.naturalHeight, 2);
});

test('image loading rejects when the browser reports a decode error', async () => {
  await assert.rejects(loadImage('broken', FakeImage), /Görsel çözümlenemedi/);
});

test('portrait mobile HUD keeps the home-return control visible alongside help', async () => {
  const css = await readFile(new URL('../src/style.css', import.meta.url), 'utf8');
  const portraitRule = css.match(/@media \(max-width: 640px\) and \(orientation: portrait\), \(max-width: 640px\) \{([\s\S]*?)\n\}/)?.[1];
  assert.ok(portraitRule, 'mobile portrait media rule exists');
  assert.match(portraitRule, /\.hud-actions\s*>\s*:not\(#btn-open-help\):not\(#btn-home-screen\)\s*\{\s*display:\s*none\s*!important;/);
  assert.match(portraitRule, /\.hud-actions\s+#btn-home-screen\s*\{[^}]*display:\s*inline-flex;[^}]*min-height:\s*40px;/s);
});
