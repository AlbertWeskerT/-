import WebSocket from 'ws';

const URL = 'ws://localhost:8787/ws';

function connect(label) {
  return new Promise((resolve) => {
    const ws = new WebSocket(URL);
    ws.__label = label;
    ws.on('open', () => resolve(ws));
  });
}

function nextMessage(ws) {
  return new Promise((resolve) => {
    ws.once('message', (raw) => {
      const msg = JSON.parse(raw.toString());
      console.log(`[${ws.__label}] <-`, msg.type, JSON.stringify(msg).slice(0, 160));
      resolve(msg);
    });
  });
}

const host = await connect('HOST');
const guest = await connect('GUEST');

host.send(JSON.stringify({ type: 'create-room', nickname: 'Alice' }));
const created = await nextMessage(host);
const roomCode = created.room.code;
const hostId = created.selfId;
console.log(`\nRoom code: ${roomCode}\n`);

const duplicateRoomDenied = nextMessage(host);
host.send(JSON.stringify({ type: 'create-room', nickname: 'Alice again' }));
const duplicateRoomError = await duplicateRoomDenied;
console.assert(duplicateRoomError.type === 'error', 'client was allowed to create a second room without leaving');

const hostPeerJoinedPromise = nextMessage(host);
guest.send(JSON.stringify({ type: 'join-room', code: roomCode, nickname: 'Bob' }));
const joined = await nextMessage(guest);
const guestId = joined.selfId;
await hostPeerJoinedPromise;

const guestSignalArrivesAtHost = nextMessage(host);
guest.send(JSON.stringify({
  type: 'signal',
  targetId: hostId,
  data: { kind: 'offer', sdp: 'v=0 FAKE-SDP-OFFER' },
}));
const offerAtHost = await guestSignalArrivesAtHost;
console.assert(offerAtHost.type === 'signal' && offerAtHost.data.kind === 'offer', 'offer relay failed');

const answerArrivesAtGuest = nextMessage(guest);
host.send(JSON.stringify({
  type: 'signal',
  targetId: guestId,
  data: { kind: 'answer', sdp: 'v=0 FAKE-SDP-ANSWER' },
}));
const answerAtGuest = await answerArrivesAtGuest;
console.assert(answerAtGuest.type === 'signal' && answerAtGuest.data.kind === 'answer', 'answer relay failed');

const roomUpdatedAtGuest = nextMessage(guest);
host.send(JSON.stringify({ type: 'set-active-preset', presetId: 'watch-together' }));
const updated = await roomUpdatedAtGuest;
console.assert(updated.room.activePresetId === 'watch-together', 'preset broadcast failed');

const guestPresetDenied = nextMessage(guest);
guest.send(JSON.stringify({ type: 'set-active-preset', presetId: 'full-control' }));
const presetError = await guestPresetDenied;
console.assert(presetError.type === 'error', 'guest was allowed to change the active preset');

const guestQualityDenied = nextMessage(guest);
guest.send(JSON.stringify({
  type: 'set-active-quality',
  quality: { resolutionTier: 1440, fps: 60, prioritize: 'clarity', mode: 'manual' },
}));
const qualityError = await guestQualityDenied;
console.assert(qualityError.type === 'error', 'guest was allowed to change the stream quality');

const outsider = await connect('OUTSIDER');
outsider.send(JSON.stringify({ type: 'create-room', nickname: 'Mallory' }));
const outsiderCreated = await nextMessage(outsider);
const guestCrossRoomSignalDenied = nextMessage(guest);
guest.send(JSON.stringify({
  type: 'signal',
  targetId: outsiderCreated.selfId,
  data: { kind: 'offer', sdp: 'v=0 CROSS-ROOM-OFFER' },
}));
const crossRoomError = await guestCrossRoomSignalDenied;
console.assert(crossRoomError.type === 'error', 'cross-room signal relay was allowed');
outsider.close();

const peerLeftAtHost = nextMessage(host);
guest.send(JSON.stringify({ type: 'leave-room' }));
await peerLeftAtHost;

console.log('\n✅ All signaling flows passed: create-room, join-room, offer/answer relay, preset broadcast, leave-room.');

host.close();
guest.close();
process.exit(0);
