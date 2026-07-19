import assert from 'node:assert/strict';
import test from 'node:test';
import { buildRoomInvitationUrl, parseRoomInvitation } from '../src/lib/roomLink.ts';

test('builds and parses a stable encoded invitation URL', () => {
  const invitation = { roomId: '123e4567-e89b-42d3-a456-426614174000', inviteToken: 'A'.repeat(43) };
  const url = buildRoomInvitationUrl('https://watch.example.com/', invitation);
  assert.equal(url, `https://watch.example.com/room/${invitation.roomId}?invite=${invitation.inviteToken}`);
  const parsed = new URL(url);
  assert.deepEqual(parseRoomInvitation({ pathname: parsed.pathname, search: parsed.search }), invitation);
  assert.equal(parseRoomInvitation({ pathname: '/room/not-a-room', search: '?invite=short' }), null);
});

test('parses an invitation served from a GitHub Pages project base path', () => {
  const invitation = { roomId: '123e4567-e89b-42d3-a456-426614174000', inviteToken: 'B'.repeat(43) };
  assert.deepEqual(
    parseRoomInvitation({ pathname: `/-/room/${invitation.roomId}`, search: `?invite=${invitation.inviteToken}` }),
    invitation,
  );
});
