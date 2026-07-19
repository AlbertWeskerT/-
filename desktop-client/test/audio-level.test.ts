import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateRms, SpeechActivityDetector } from '../src/lib/audioLevel.ts';

test('calculates RMS without depending on sample polarity', () => {
  assert.equal(calculateRms(new Float32Array()), 0);
  assert.ok(Math.abs(calculateRms(new Float32Array([1, -1, 1, -1])) - 1) < 0.0001);
});

test('speech detector debounces attack and delays release', () => {
  const detector = new SpeechActivityDetector({ threshold: 0.01, noiseFloor: 0.001, attackSamples: 2, releaseSamples: 3 });
  assert.equal(detector.update(0.2).speaking, false);
  assert.equal(detector.update(0.2).speaking, true);
  assert.equal(detector.update(0).speaking, true);
  assert.equal(detector.update(0).speaking, true);
  for (let index = 0; index < 8; index += 1) detector.update(0);
  assert.equal(detector.update(0).speaking, false);
});

test('speech detector smooths and clamps levels', () => {
  const detector = new SpeechActivityDetector();
  const sample = detector.update(4);
  assert.ok(sample.level > 0 && sample.level <= 1);
});
