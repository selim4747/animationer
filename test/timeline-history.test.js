import test from 'node:test';
import assert from 'node:assert/strict';
import { ACTION_TYPES, TimelineManager } from '../src/components/TimelineManager.js';

const makeTimeline = () => new TimelineManager({});

test('cloneStep inserts a distinct deep copy immediately after its source', () => {
  const timeline = makeTimeline();
  const source = timeline.steps[0];
  source.data.nested = { value: 1 };
  const clone = timeline.cloneStep(0);
  assert.equal(timeline.steps[1], clone);
  assert.notEqual(clone.id, source.id);
  assert.deepEqual(clone.data, source.data);
  assert.notEqual(clone.data, source.data);
  clone.data.nested.value = 2;
  assert.equal(source.data.nested.value, 1);
  assert.equal(timeline.cloneStep(-1), null);
  assert.equal(timeline.cloneStep(100), null);
});

test('editing a step title and parameters participates in undo/redo history', () => {
  const timeline = makeTimeline();
  assert.equal(timeline.updateStep(2, { title: 'Wait here', data: { duration: 2.5 } }), true);
  assert.equal(timeline.steps[2].title, 'Wait here');
  assert.equal(timeline.steps[2].data.duration, 2.5);
  assert.equal(timeline.undo(), true);
  assert.notEqual(timeline.steps[2].title, 'Wait here');
  assert.equal(timeline.redo(), true);
  assert.equal(timeline.steps[2].data.duration, 2.5);
  assert.equal(timeline.updateStep(2, { data: { duration: -1 } }), false);
  assert.equal(timeline.steps[2].data.duration, 2.5);
});

test('undo and redo cover add, reorder, remove, clear, and import', () => {
  const timeline = makeTimeline();
  const original = structuredClone(timeline.steps);
  timeline.addStep(ACTION_TYPES.WAIT, { duration: 3 });
  assert.equal(timeline.undo(), true);
  assert.deepEqual(timeline.steps, original);
  assert.equal(timeline.redo(), true);
  assert.equal(timeline.steps.length, original.length + 1);

  const beforeMove = structuredClone(timeline.steps);
  timeline.moveStep(0, 1);
  assert.equal(timeline.undo(), true);
  assert.deepEqual(timeline.steps, beforeMove);
  timeline.removeStep(0);
  assert.equal(timeline.undo(), true);
  assert.deepEqual(timeline.steps, beforeMove);

  timeline.clear();
  assert.deepEqual(timeline.steps, []);
  assert.equal(timeline.undo(), true);
  assert.deepEqual(timeline.steps, beforeMove);

  timeline.importSequence({ steps: [{ type: ACTION_TYPES.WAIT, data: { duration: 5 } }] });
  assert.equal(timeline.steps.length, 1);
  assert.equal(timeline.undo(), true);
  assert.deepEqual(timeline.steps, beforeMove);
  assert.equal(timeline.redo(), true);
  assert.equal(timeline.steps.length, 1);
});

test('history snapshots are independent of later nested data mutations', () => {
  const timeline = makeTimeline();
  const before = structuredClone(timeline.steps);
  timeline.addStep(ACTION_TYPES.WAIT, { duration: 1 });
  timeline.steps[0].data.duration = 99;
  assert.equal(timeline.undo(), true);
  assert.deepEqual(timeline.steps, before);
});

test('undo/redo are unavailable during playback and undo history is capped at 50', () => {
  const timeline = makeTimeline();
  for (let i = 0; i < 60; i++) timeline.addStep(ACTION_TYPES.WAIT, { duration: i + 1 });
  assert.equal(timeline._undoStack.length, 50);
  timeline.isPlaying = true;
  assert.equal(timeline.undo(), false);
  assert.equal(timeline.redo(), false);
  timeline.isPlaying = false;
  let undone = 0;
  while (timeline.undo()) undone++;
  assert.equal(undone, 50);
  assert.equal(timeline.undo(), false);
});

test('a new edit after undo discards the redo branch; invalid imports do not enter history', () => {
  const timeline = makeTimeline();
  timeline.addStep(ACTION_TYPES.WAIT, { duration: 1 });
  timeline.undo();
  timeline.addStep(ACTION_TYPES.WAIT, { duration: 2 });
  assert.equal(timeline.redo(), false);
  const count = timeline._undoStack.length;
  assert.throws(() => timeline.importSequence({ steps: [{ type: 'BAD', data: {} }] }));
  assert.equal(timeline._undoStack.length, count);
});
