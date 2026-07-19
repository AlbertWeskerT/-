import assert from 'node:assert/strict';
import test from 'node:test';
import { MAX_CHAT_IMAGE_LENGTH, parseClientMessage } from '../../shared/protocol';

test('rejects valid JSON primitives instead of throwing', () => {
  for (const raw of ['null', 'true', '42', '[]', '"ping"']) {
    const parsed = parseClientMessage(raw);
    assert.equal(parsed.ok, false);
    if (!parsed.ok) assert.equal(parsed.code, 'INVALID_MESSAGE');
  }
});

test('normalizes valid room messages', () => {
  assert.deepEqual(parseClientMessage('{"type":"create-room","nickname":"  Alice  "}'), {
    ok: true,
    value: { type: 'create-room', nickname: 'Alice' },
  });
  assert.deepEqual(parseClientMessage('{"type":"join-room","code":"  abc234  ","nickname":"Bob"}'), {
    ok: true,
    value: { type: 'join-room', code: 'ABC234', nickname: 'Bob' },
  });
});

test('rejects missing, control-character and oversized nicknames', () => {
  for (const nickname of [undefined, '', 'A\u0000B', 'x'.repeat(41)]) {
    const raw = JSON.stringify({ type: 'create-room', ...(nickname === undefined ? {} : { nickname }) });
    assert.equal(parseClientMessage(raw).ok, false);
  }
});

test('rejects invalid quality and unknown preset values', () => {
  assert.equal(parseClientMessage(JSON.stringify({ type: 'set-active-quality', quality: null })).ok, false);
  assert.equal(parseClientMessage(JSON.stringify({
    type: 'set-active-quality',
    quality: { resolutionTier: 999, fps: 120, prioritize: 'speed', mode: 'manual' },
  })).ok, false);
  assert.equal(parseClientMessage(JSON.stringify({ type: 'set-active-preset', presetId: 'not-real' })).ok, false);
});

test('accepts a bounded typed ICE candidate', () => {
  const parsed = parseClientMessage(JSON.stringify({
    type: 'signal',
    targetId: '123e4567-e89b-42d3-a456-426614174000',
    data: {
      kind: 'ice-candidate',
      candidate: { candidate: 'candidate:1 1 UDP 1 127.0.0.1 9999 typ host', sdpMid: '0', sdpMLineIndex: 0 },
    },
  }));
  assert.equal(parsed.ok, true);
});

test('rejects unknown fields and message types', () => {
  assert.equal(parseClientMessage('{"type":"ping","extra":true}').ok, false);
  assert.equal(parseClientMessage('{"type":"become-host"}').ok, false);
});

test('validates reconnect tokens', () => {
  const token = 'A'.repeat(43);
  assert.deepEqual(parseClientMessage(JSON.stringify({ type: 'resume-session', resumeToken: token })), {
    ok: true,
    value: { type: 'resume-session', resumeToken: token },
  });
  assert.equal(parseClientMessage(JSON.stringify({ type: 'resume-session', resumeToken: 'short' })).ok, false);
});

test('validates room invitation joins', () => {
  const message = {
    type: 'join-room',
    roomId: '123e4567-e89b-42d3-a456-426614174000',
    inviteToken: 'A'.repeat(43),
    nickname: 'Guest',
  };
  assert.deepEqual(parseClientMessage(JSON.stringify(message)), { ok: true, value: message });
  assert.equal(parseClientMessage(JSON.stringify({ ...message, inviteToken: 'short' })).ok, false);
  assert.equal(parseClientMessage(JSON.stringify({ ...message, roomId: '../room' })).ok, false);
});

test('validates bounded chat messages and JPEG data URLs', () => {
  const id = '123e4567-e89b-42d3-a456-426614174000';
  assert.deepEqual(parseClientMessage(JSON.stringify({ type: 'chat-message', id, text: ' hello ' })), {
    ok: true,
    value: { type: 'chat-message', id, text: 'hello' },
  });
  assert.equal(parseClientMessage(JSON.stringify({ type: 'chat-message', id, text: '' })).ok, false);
  assert.equal(parseClientMessage(JSON.stringify({ type: 'chat-message', id, text: 'ok', imageDataUrl: 'data:image/png;base64,AAAA' })).ok, false);
  assert.equal(parseClientMessage(JSON.stringify({
    type: 'chat-message', id, text: '', imageDataUrl: `data:image/jpeg;base64,${'A'.repeat(MAX_CHAT_IMAGE_LENGTH)}`,
  })).ok, false);
});
