import assert from 'node:assert/strict';
import test from 'node:test';
import { createControlNonce, parseControlSessionMessage } from '../src/lib/controlState.ts';

test('creates bounded nonces and validates explicit control sessions', () => {
  const nonce = createControlNonce();
  assert.match(nonce, /^[A-Za-z0-9_-]{43}$/);
  const requestId = '123e4567-e89b-42d3-a456-426614174000';
  assert.deepEqual(parseControlSessionMessage({ kind: 'control-request', requestId, capabilities: { mouse: true, keyboard: false }, requestedAt: 10 }), {
    kind: 'control-request', requestId, capabilities: { mouse: true, keyboard: false }, requestedAt: 10,
  });
});

test('rejects out-of-range coordinates and invalid event sequences', () => {
  const common = { kind: 'control-event', sessionId: '123e4567-e89b-42d3-a456-426614174000', nonce: 'A'.repeat(43) };
  assert.equal(parseControlSessionMessage({ ...common, sequence: 0, event: { type: 'mouseMove', x: 0.5, y: 0.5 } }), null);
  assert.equal(parseControlSessionMessage({ ...common, sequence: 1, event: { type: 'mouseMove', x: -0.1, y: 0.5 } }), null);
  assert.ok(parseControlSessionMessage({ ...common, sequence: 1, event: { type: 'key', code: 'KeyA', action: 'down' } }));
  assert.equal(parseControlSessionMessage({ ...common, sequence: 2, event: { type: 'key', code: 'MetaLeft', action: 'down' } }), null);
});
