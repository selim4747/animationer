import test from 'node:test';
import assert from 'node:assert/strict';
import { PerformanceDiagnostics } from '../src/components/PerformanceDiagnostics.js';

test('does not collect or publish metrics until explicitly enabled', () => {
  const updates = [];
  const diagnostics = new PerformanceDiagnostics({ onUpdate: (snapshot) => updates.push(snapshot), now: () => 100 });

  assert.equal(diagnostics.recordFrame(16, { render: { calls: 7 } }, 200), false);
  assert.equal(updates.length, 0);
  diagnostics.setEnabled(true);
  assert.equal(updates.at(-1).enabled, true);
});

test('publishes averaged FPS and renderer counters at the throttled interval', () => {
  let now = 0;
  const updates = [];
  const diagnostics = new PerformanceDiagnostics({
    updateIntervalMs: 500,
    onUpdate: (snapshot) => updates.push(snapshot),
    now: () => now,
  });
  diagnostics.setEnabled(true);
  const info = { render: { calls: 42, triangles: 4096 }, memory: { geometries: 12, textures: 9 } };

  diagnostics.recordFrame(16, info, 250);
  assert.equal(updates.length, 1, 'only the enable-state update is published before the interval elapses');
  diagnostics.recordFrame(16, info, 500);

  assert.equal(updates.length, 2);
  assert.equal(updates[1].fps, 62.5);
  assert.equal(updates[1].frameTimeMs, 16);
  assert.equal(updates[1].drawCalls, 42);
  assert.equal(updates[1].triangles, 4096);
  assert.equal(updates[1].geometries, 12);
  assert.equal(updates[1].textures, 9);
  assert.equal(updates[1].jsHeapUsedMB, null, 'unsupported browser heap metrics remain unavailable rather than fabricated');
});

test('disabling diagnostics resets the snapshot and ignores subsequent frames', () => {
  const updates = [];
  let now = 0;
  const diagnostics = new PerformanceDiagnostics({ onUpdate: (snapshot) => updates.push(snapshot), now: () => now });
  diagnostics.setEnabled(true);
  diagnostics.recordFrame(20, { render: { calls: 5 } }, 500);
  diagnostics.setEnabled(false);

  assert.equal(updates.at(-1).enabled, false);
  assert.equal(updates.at(-1).fps, null);
  assert.equal(diagnostics.recordFrame(12, { render: { calls: 99 } }, 1000), false);
  assert.equal(updates.length, 3);
});


test('ignores zero-duration frames so an initial timestamp cannot inflate the first FPS sample', () => {
  const updates = [];
  const diagnostics = new PerformanceDiagnostics({ onUpdate: (snapshot) => updates.push(snapshot), now: () => 0 });
  const info = { render: { calls: 8 } };
  diagnostics.setEnabled(true);

  assert.equal(diagnostics.recordFrame(0, info, 500), false);
  assert.equal(updates.length, 1, 'a zero-delta frame is not published as a sample');
  assert.equal(diagnostics.recordFrame(20, info, 500), true);
  assert.equal(updates.at(-1).frameTimeMs, 20);
  assert.equal(updates.at(-1).fps, 50);
});
