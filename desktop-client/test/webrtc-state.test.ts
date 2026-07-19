import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateReconnectDelay, decideOfferCollision, IceCandidateQueue } from '../src/lib/webrtcState.ts';

test('queues and drains ICE candidates in arrival order', () => {
  const queue = new IceCandidateQueue();
  const first = { candidate: 'candidate:first', sdpMid: '0', sdpMLineIndex: 0 };
  const second = { candidate: 'candidate:second', sdpMid: '0', sdpMLineIndex: 0 };
  queue.add(first);
  queue.add(second);
  assert.equal(queue.size, 2);
  assert.deepEqual(queue.drain(), [first, second]);
  assert.equal(queue.size, 0);
});

test('clears candidates belonging to an ignored offer', () => {
  const queue = new IceCandidateQueue();
  queue.add({ candidate: 'candidate:stale', sdpMid: null, sdpMLineIndex: null });
  queue.clear();
  assert.deepEqual(queue.drain(), []);
});

test('perfect negotiation ignores a collision only on the impolite side', () => {
  const common = {
    descriptionType: 'offer' as const,
    makingOffer: true,
    signalingState: 'have-local-offer' as const,
    isSettingRemoteAnswerPending: false,
  };
  assert.deepEqual(decideOfferCollision({ ...common, polite: false }), { collision: true, ignore: true });
  assert.deepEqual(decideOfferCollision({ ...common, polite: true }), { collision: true, ignore: false });
});

test('answer and stable offers are not collisions', () => {
  assert.deepEqual(decideOfferCollision({
    descriptionType: 'answer', polite: false, makingOffer: false, signalingState: 'have-local-offer', isSettingRemoteAnswerPending: false,
  }), { collision: false, ignore: false });
  assert.deepEqual(decideOfferCollision({
    descriptionType: 'offer', polite: false, makingOffer: false, signalingState: 'stable', isSettingRemoteAnswerPending: false,
  }), { collision: false, ignore: false });
});

test('reconnect delay is exponential and capped', () => {
  assert.deepEqual([1, 2, 3, 4, 5, 10].map((attempt) => calculateReconnectDelay(attempt)), [750, 1500, 3000, 6000, 10000, 10000]);
});
