export interface RoomInvitation {
  roomId: string;
  inviteToken: string;
}

const ROOM_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const INVITE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export function parseRoomInvitation(location: Pick<Location, 'pathname' | 'search'>): RoomInvitation | null {
  const match = /^\/room\/([^/]+)\/?$/.exec(location.pathname);
  const inviteToken = new URLSearchParams(location.search).get('invite') ?? '';
  const roomId = match ? decodeURIComponent(match[1]) : '';
  if (!ROOM_ID_PATTERN.test(roomId) || !INVITE_TOKEN_PATTERN.test(inviteToken)) return null;
  return { roomId, inviteToken };
}

export function buildRoomInvitationUrl(publicAppUrl: string, invitation: RoomInvitation): string {
  const base = publicAppUrl.replace(/\/+$/, '');
  return `${base}/room/${encodeURIComponent(invitation.roomId)}?invite=${encodeURIComponent(invitation.inviteToken)}`;
}
