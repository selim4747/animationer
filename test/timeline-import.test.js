import test from 'node:test';
import assert from 'node:assert/strict';
import { ACTION_TYPES, TimelineManager } from '../src/components/TimelineManager.js';

function createTimeline() {
  return new TimelineManager({});
}

test('imports valid timeline steps and normalizes data', () => {
  const timeline = createTimeline();
  const result = timeline.importSequence(JSON.stringify({
    version: '1.0.0',
    steps: [
      { type: ACTION_TYPES.MOVE_TO, title: 'Go', data: { x: '1.5', y: 0, z: -2 } },
      { type: ACTION_TYPES.WAIT, data: { duration: 2 } },
    ],
  }));

  assert.equal(result, true);
  assert.equal(timeline.steps.length, 2);
  assert.deepEqual(timeline.steps[0].data, { x: 1.5, y: 0, z: -2 });
  assert.equal(timeline.steps[1].title, '2 Saniye Bekle');
});

test('rejects invalid actions without replacing the current queue', () => {
  const timeline = createTimeline();
  const before = structuredClone(timeline.steps);

  assert.throws(() => timeline.importSequence({
    steps: [{ type: 'RUN_SCRIPT', title: 'bad', data: {} }],
  }));
  assert.deepEqual(timeline.steps, before);
});

test('rejects invalid coordinates, durations, and oversized sequences', () => {
  const timeline = createTimeline();
  assert.throws(() => timeline.importSequence({
    steps: [{ type: ACTION_TYPES.MOVE_TO, data: { x: 'Infinity', y: 0, z: 0 } }],
  }));
  assert.throws(() => timeline.importSequence({
    steps: [{ type: ACTION_TYPES.WAIT, data: { duration: 3601 } }],
  }));
  assert.throws(() => timeline.importSequence({ steps: Array(5001).fill(null) }));
});

test('bounds untrusted titles while preserving them as plain text values', () => {
  const timeline = createTimeline();
  const title = '<img src=x onerror=alert(1)>';
  timeline.importSequence({
    steps: [{ type: ACTION_TYPES.WAIT, title, data: { duration: 1 } }],
  });
  assert.equal(timeline.steps[0].title, title);

  timeline.importSequence({
    steps: [{ type: ACTION_TYPES.WAIT, title: 'x'.repeat(500), data: { duration: 1 } }],
  });
  assert.equal(timeline.steps[0].title.length, 160);
});
