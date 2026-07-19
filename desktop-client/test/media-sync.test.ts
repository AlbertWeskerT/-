import assert from 'node:assert/strict';
import test from 'node:test';
import { parseMediaSyncMessage, targetMediaTime } from '../src/lib/mediaSync.ts';

test('projects the host timeline with measured clock offset', () => {
  const state = { kind: 'media-sync-state' as const, mediaId: 'a'.repeat(64), sequence: 1, playing: true, currentTime: 10, playbackRate: 1, sentAt: 1_000 };
  assert.equal(targetMediaTime(state, 2_000, 500), 11.5);
  assert.equal(targetMediaTime({ ...state, playing: false }, 2_000, 500), 10);
});

test('validates synchronized media state', () => {
  const state = { kind: 'media-sync-state', mediaId: 'a'.repeat(64), sequence: 1, playing: false, currentTime: 0, playbackRate: 1, sentAt: 10 };
  assert.deepEqual(parseMediaSyncMessage(state), state);
  assert.equal(parseMediaSyncMessage({ ...state, playbackRate: 9 }), null);
});
