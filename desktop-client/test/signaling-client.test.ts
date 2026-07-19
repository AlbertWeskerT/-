import assert from 'node:assert/strict';
import test from 'node:test';
import { initialConnectionPolicy } from '../src/lib/webrtcState.ts';

test('uses a short bounded policy for local signaling', () => {
  assert.deepEqual(initialConnectionPolicy('ws://localhost:8787/ws'), {
    maxAttempts: 2,
    overallTimeoutMs: 12_000,
    perAttemptTimeoutMs: 8_000,
    showWakeState: false,
  });
});

test('allows a bounded cold-start window for Render Free', () => {
  const policy = initialConnectionPolicy('wss://watch-together-p2p-ghost.onrender.com/ws');
  assert.equal(policy.showWakeState, true);
  assert.equal(policy.overallTimeoutMs, 70_000);
  assert.equal(policy.maxAttempts, 12);
});
