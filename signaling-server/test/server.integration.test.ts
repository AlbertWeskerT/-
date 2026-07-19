import assert from 'node:assert/strict';
import test from 'node:test';
import WebSocket from 'ws';
import type { ServerToClientMessage } from '../../shared/protocol';
import { RoomRegistry } from '../src/rooms';
import { createWatchTogetherServer } from '../src/server';

interface Inbox {
  queue: ServerToClientMessage[];
  waiters: Array<(message: ServerToClientMessage) => void>;
}

const inboxes = new WeakMap<WebSocket, Inbox>();

function connect(url: string, origin?: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url, origin ? { origin } : undefined);
    const inbox: Inbox = { queue: [], waiters: [] };
    inboxes.set(ws, inbox);
    ws.on('message', (raw) => {
      const message = JSON.parse(raw.toString()) as ServerToClientMessage;
      const waiter = inbox.waiters.shift();
      if (waiter) waiter(message);
      else inbox.queue.push(message);
    });
    ws.once('open', () => resolve(ws));
    ws.once('error', reject);
  });
}

test('origin policy normalizes configured origins and rejects missing or unlisted origins', async () => {
  const application = createWatchTogetherServer({
    port: 0,
    allowedOrigins: [' https://albertweskert.github.io/some/path ', ' http://tauri.localhost/ '],
  });
  const port = await application.start();
  const url = `ws://127.0.0.1:${port}/ws`;
  try {
    const browser = await connect(url, 'https://albertweskert.github.io');
    const desktop = await connect(url, 'http://tauri.localhost');
    await assert.rejects(connect(url, 'https://example.com'));
    await assert.rejects(connect(url));
    browser.close();
    desktop.close();
  } finally {
    await application.stop();
  }
});

function nextMessage(ws: WebSocket, timeoutMs = 2_000): Promise<ServerToClientMessage> {
  return new Promise((resolve, reject) => {
    const inbox = inboxes.get(ws);
    if (!inbox) return reject(new Error('Socket inbox is unavailable.'));
    const queued = inbox.queue.shift();
    if (queued) return resolve(queued);
    const timer = setTimeout(() => reject(new Error('Timed out waiting for WebSocket message.')), timeoutMs);
    inbox.waiters.push((message) => {
      clearTimeout(timer);
      resolve(message);
    });
  });
}

async function nextOfType<T extends ServerToClientMessage['type']>(ws: WebSocket, type: T): Promise<Extract<ServerToClientMessage, { type: T }>> {
  for (;;) {
    const message = await nextMessage(ws);
    if (message.type === type) return message as Extract<ServerToClientMessage, { type: T }>;
  }
}

async function withServer(run: (url: string) => Promise<void>, registry = new RoomRegistry()): Promise<void> {
  const application = createWatchTogetherServer({ port: 0, registry, messageRateLimitPerMinute: 1_000, reconnectGraceMs: 50 });
  const port = await application.start();
  try {
    await run(`ws://127.0.0.1:${port}/ws`);
  } finally {
    await application.stop();
  }
}

test('invalid JSON values return an error and do not crash the server', async () => {
  await withServer(async (url) => {
    const ws = await connect(url);
    ws.send('null');
    const error = await nextMessage(ws);
    assert.equal(error.type, 'error');
    if (error.type === 'error') assert.equal(error.code, 'INVALID_MESSAGE');

    ws.send(JSON.stringify({ type: 'create-room', nickname: 'Alive' }));
    assert.equal((await nextMessage(ws)).type, 'room-created');
    ws.close();
  });
});

test('host disconnect closes the room after the reconnect grace period', async () => {
  await withServer(async (url) => {
    const host = await connect(url);
    const guest = await connect(url);
    host.send(JSON.stringify({ type: 'create-room', nickname: 'Host' }));
    const created = await nextMessage(host);
    assert.equal(created.type, 'room-created');
    if (created.type !== 'room-created') return;

    guest.send(JSON.stringify({ type: 'join-room', code: created.room.code, nickname: 'Guest' }));
    assert.equal((await nextMessage(guest)).type, 'room-joined');
    assert.equal((await nextMessage(host)).type, 'peer-joined');
    host.close();
    const offline = await nextOfType(guest, 'participant-connection');
    assert.equal(offline.type, 'participant-connection');
    if (offline.type === 'participant-connection') assert.equal(offline.connected, false);
    const closed = await nextOfType(guest, 'room-closed');
    assert.deepEqual(closed, { type: 'room-closed', reason: 'host-disconnected' });

    guest.send(JSON.stringify({ type: 'set-active-preset', presetId: 'watch-together' }));
    const denied = await nextMessage(guest);
    assert.equal(denied.type, 'error');
    if (denied.type === 'error') assert.equal(denied.code, 'NOT_IN_ROOM');
    guest.close();
  });
});

test('host resumes the same session during the reconnect grace period', async () => {
  await withServer(async (url) => {
    const host = await connect(url);
    const guest = await connect(url);
    host.send(JSON.stringify({ type: 'create-room', nickname: 'Host' }));
    const created = await nextMessage(host);
    assert.equal(created.type, 'room-created');
    if (created.type !== 'room-created') return;
    guest.send(JSON.stringify({ type: 'join-room', code: created.room.code, nickname: 'Guest' }));
    await nextMessage(guest);
    await nextMessage(host);

    host.close();
    const offline = await nextOfType(guest, 'participant-connection');
    assert.equal(offline.type, 'participant-connection');

    const resumedHost = await connect(url);
    resumedHost.send(JSON.stringify({ type: 'resume-session', resumeToken: created.resumeToken }));
    const resumed = await nextMessage(resumedHost);
    assert.equal(resumed.type, 'session-resumed');
    if (resumed.type === 'session-resumed') assert.equal(resumed.selfId, created.selfId);
    const online = await nextOfType(guest, 'participant-connection');
    assert.deepEqual(online, { type: 'participant-connection', participantId: created.selfId, connected: true });

    resumedHost.send(JSON.stringify({ type: 'set-active-quality', quality: { resolutionTier: 720, fps: 30, prioritize: 'smoothness', mode: 'manual' } }));
    assert.equal((await nextOfType(guest, 'room-updated')).type, 'room-updated');
    resumedHost.close();
    guest.close();
  });
});

test('invite join, temporary TURN and chat history work end to end', async () => {
  const application = createWatchTogetherServer({
    port: 0,
    messageRateLimitPerMinute: 1_000,
    turnUrls: ['turn:relay.example.test:3478'],
    turnSharedSecret: 'integration-secret',
    turnCredentialTtlSeconds: 600,
  });
  const port = await application.start();
  const url = `ws://127.0.0.1:${port}/ws`;
  try {
    const host = await connect(url);
    host.send(JSON.stringify({ type: 'create-room', nickname: 'Host' }));
    const created = await nextOfType(host, 'room-created');
    const turn = created.iceServers.find((server) => server.urls.includes('turn:relay.example.test:3478'));
    assert.ok(turn?.username);
    assert.ok(turn?.credential);
    assert.notEqual(turn.credential, 'integration-secret');

    const guest = await connect(url);
    guest.send(JSON.stringify({
      type: 'join-room', roomId: created.room.id, inviteToken: created.inviteToken, nickname: 'Guest',
    }));
    const joined = await nextOfType(guest, 'room-joined');
    assert.equal(joined.room.id, created.room.id);
    await nextOfType(host, 'peer-joined');

    const messageId = '123e4567-e89b-42d3-a456-426614174000';
    guest.send(JSON.stringify({ type: 'chat-message', id: messageId, text: 'persistent hello' }));
    const hostChat = await nextOfType(host, 'chat-message');
    const guestChat = await nextOfType(guest, 'chat-message');
    assert.equal(hostChat.message.id, messageId);
    assert.equal(guestChat.message.nickname, 'Guest');

    guest.close();
    await nextOfType(host, 'participant-connection');
    const resumedGuest = await connect(url);
    resumedGuest.send(JSON.stringify({ type: 'resume-session', resumeToken: joined.resumeToken }));
    await nextOfType(resumedGuest, 'session-resumed');
    const history = await nextOfType(resumedGuest, 'chat-history');
    assert.deepEqual(history.messages.map((message) => message.id), [messageId]);

    resumedGuest.close();
    host.close();
  } finally {
    await application.stop();
  }
});

test('server blocks cross-room signaling and guest host-only actions', async () => {
  await withServer(async (url) => {
    const hostA = await connect(url);
    const guestA = await connect(url);
    const hostB = await connect(url);
    hostA.send(JSON.stringify({ type: 'create-room', nickname: 'Host A' }));
    hostB.send(JSON.stringify({ type: 'create-room', nickname: 'Host B' }));
    const roomA = await nextMessage(hostA);
    const roomB = await nextMessage(hostB);
    assert.equal(roomA.type, 'room-created');
    assert.equal(roomB.type, 'room-created');
    if (roomA.type !== 'room-created' || roomB.type !== 'room-created') return;

    guestA.send(JSON.stringify({ type: 'join-room', code: roomA.room.code, nickname: 'Guest A' }));
    assert.equal((await nextMessage(guestA)).type, 'room-joined');
    await nextMessage(hostA);

    guestA.send(JSON.stringify({
      type: 'signal',
      targetId: roomB.selfId,
      data: { kind: 'offer', sdp: 'v=0\r\n' },
    }));
    const blockedSignal = await nextOfType(guestA, 'error');
    assert.equal(blockedSignal.type, 'error');
    if (blockedSignal.type === 'error') assert.equal(blockedSignal.code, 'FORBIDDEN');

    guestA.send(JSON.stringify({ type: 'set-active-quality', quality: { resolutionTier: 720, fps: 30, prioritize: 'smoothness', mode: 'manual' } }));
    const blockedQuality = await nextOfType(guestA, 'error');
    assert.equal(blockedQuality.type, 'error');
    if (blockedQuality.type === 'error') assert.equal(blockedQuality.code, 'FORBIDDEN');

    hostA.close();
    guestA.close();
    hostB.close();
  });
});
