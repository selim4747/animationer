import test from 'node:test';
import assert from 'node:assert/strict';
import { getDevicePerformanceProfile, getRendererPixelRatio } from '../src/utils/device-profile.js';

test('low-memory devices use a smaller video cap, 30 FPS ceiling and lower render pixel ratio', () => {
  assert.deepEqual(getDevicePerformanceProfile(2), {
    maxRecordingBytes: 32 * 1024 * 1024,
    maxFrameRate: 30,
    maxPixelRatio: 1,
    maxProjectAssetExportBytes: 12 * 1024 * 1024,
  });
  assert.equal(getRendererPixelRatio(3, 2), 1);
});

test('mid-memory devices limit output memory and high-density rendering', () => {
  assert.deepEqual(getDevicePerformanceProfile(4), {
    maxRecordingBytes: 64 * 1024 * 1024,
    maxFrameRate: 60,
    maxPixelRatio: 1.5,
    maxProjectAssetExportBytes: 20 * 1024 * 1024,
  });
  assert.equal(getRendererPixelRatio(3, 4), 1.5);
});

test('unknown and higher memory devices retain conservative FPS defaults and bounded pixel ratio', () => {
  assert.deepEqual(getDevicePerformanceProfile(null), {
    maxRecordingBytes: 128 * 1024 * 1024,
    maxFrameRate: 60,
    maxPixelRatio: 2,
    maxProjectAssetExportBytes: 50 * 1024 * 1024,
  });
  assert.equal(getRendererPixelRatio(3, null), 2);
  assert.equal(getRendererPixelRatio(0, 8), 1);
});
