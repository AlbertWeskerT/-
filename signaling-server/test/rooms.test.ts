import assert from 'node:assert/strict';
import test from 'node:test';
import { RoomRegistry } from '../src/rooms';

test('creates an unpredictable-format room code and unique participants', () => {
  const registry = new RoomRegistry();
  const first = registry.createRoom('Alice');
  const second = registry.createRoom('Bob');
  assert.match(first.room.code, /^[A-HJ-NP-Z2-9]{6}$/);
  assert.notEqual(first.room.code, second.room.code);
  assert.notEqual(first.hostParticipant.id, second.hostParticipant.id);
});

test('enforces participant limit', () => {
  const registry = new RoomRegistry({ maxParticipants: 2 });
  const { room } = registry.createRoom('Host');
  assert.ok('participant' in registry.joinRoom(room.code, 'Guest'));
  const full = registry.joinRoom(room.code, 'Extra');
  assert.ok('error' in full);
  if ('error' in full) assert.equal(full.code, 'ROOM_FULL');
});

test('host leave returns the closed room snapshot', () => {
  const registry = new RoomRegistry();
  const { room, hostParticipant } = registry.createRoom('Host');
  registry.joinRoom(room.code, 'Guest');
  const result = registry.leaveRoom(room.id, hostParticipant.id);
  assert.equal(result.wasHost, true);
  assert.equal(result.closedRoom?.participants.length, 2);
  assert.equal(registry.getRoom(room.id), undefined);
});

test('expires rooms using configured TTL', () => {
  const registry = new RoomRegistry({ roomTtlMs: 10 });
  const { room } = registry.createRoom('Host');
  const expired = registry.sweepExpired(Date.parse(room.createdAt) + 11);
  assert.deepEqual(expired.map((candidate) => candidate.id), [room.id]);
  assert.equal(registry.roomCount, 0);
});

test('joins through the generated invitation and rejects a different token', () => {
  const registry = new RoomRegistry();
  const { room, inviteToken } = registry.createRoom('Host');
  assert.match(inviteToken, /^[A-Za-z0-9_-]{43}$/);
  assert.ok('participant' in registry.joinRoomByInvite(room.id, inviteToken, 'Guest'));
  const denied = registry.joinRoomByInvite(room.id, 'A'.repeat(43), 'Stranger');
  assert.ok('error' in denied);
});

test('deduplicates and expires bounded chat history', () => {
  const registry = new RoomRegistry();
  const { room, hostParticipant } = registry.createRoom('Host');
  const message = { id: '123e4567-e89b-42d3-a456-426614174000', participantId: hostParticipant.id, nickname: 'Host', text: 'hello', ts: 10_000 };
  assert.equal(registry.appendChatMessage(room.id, message, 10_000)?.isNew, true);
  assert.equal(registry.appendChatMessage(room.id, message, 10_001)?.isNew, false);
  assert.deepEqual(registry.getChatHistory(room.id, 10_001), [message]);
  assert.deepEqual(registry.getChatHistory(room.id, 10_000 + 60 * 60_000 + 1), []);
});
