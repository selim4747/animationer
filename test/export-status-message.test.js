import test from 'node:test';
import assert from 'node:assert/strict';
import { saveResultMessage } from '../src/components/UIManager.js';

test('reports initiated browser downloads as started and points to browser downloads', () => {
  assert.equal(
    saveResultMessage('Video', { saved: false, initiated: true, method: 'browser', filename: 'clip.webm' }),
    'Video indirme başlatıldı: clip.webm · Tarayıcı indirilenleri',
  );
});

test('keeps canceled exports distinct from errors', () => {
  assert.equal(
    saveResultMessage('PNG', { canceled: true, error: 'Unexpected error' }),
    'PNG kaydetme işlemi iptal edildi.',
  );
});

test('reports genuine export failures', () => {
  assert.equal(saveResultMessage('PNG', { saved: false, error: 'Disk dolu.' }), 'Disk dolu.');
  assert.equal(saveResultMessage('Video', { saved: false }), 'Video cihaza kaydedilemedi.');
});

test('reports normally saved files and their location', () => {
  assert.equal(
    saveResultMessage('Proje', { saved: true, filename: 'scene.json', method: 'electron', path: 'C:\\scene.json' }),
    'Proje kaydedildi: scene.json · C:\\scene.json',
  );
});
