import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const ui = await readFile(new URL('../src/components/UIManager.js', import.meta.url), 'utf8');

test('Help dialog is labelled and provides focus return, Escape close, backdrop close, and a tab loop', () => {
  assert.match(html, /id="modal-help"[^>]*role="dialog"[^>]*aria-modal="true"[^>]*aria-labelledby="help-dialog-title"[^>]*aria-describedby="help-dialog-description"/);
  assert.match(html, /id="help-dialog-title"/);
  assert.match(html, /id="help-dialog-description"/);
  assert.match(html, /id="btn-close-help"/);
  assert.match(ui, /event\.key === 'Escape'/);
  assert.match(ui, /event\.shiftKey && document\.activeElement === first/);
  assert.match(ui, /document\.activeElement === last/);
  assert.match(ui, /returnFocus\.focus\(\)/);
  assert.match(ui, /event\.target === d\.modalHelp/);
});
