import { BUILTIN_PRESETS } from './types';
import type { ActiveQuality, FpsOption, ResolutionTier, Room } from './types';

export const MAX_SIGNALING_MESSAGE_BYTES = 256 * 1024;
export const MAX_NICKNAME_LENGTH = 40;
export const MAX_SDP_LENGTH = 200_000;
export const MAX_ICE_CANDIDATE_LENGTH = 16_384;
export const MAX_CHAT_TEXT_LENGTH = 500;
export const MAX_CHAT_IMAGE_LENGTH = 180_000;

export interface SerializableIceCandidate {
  candidate: string;
  sdpMid: string | null;
  sdpMLineIndex: number | null;
  usernameFragment?: string | null;
}

export interface IceServerConfig {
  urls: string[];
  username?: string;
  credential?: string;
}

export interface ChatRecord {
  id: string;
  participantId: string;
  nickname: string;
  text: string;
  imageDataUrl?: string;
  ts: number;
}

export type SignalPayload =
  | { kind: 'offer'; sdp: string }
  | { kind: 'answer'; sdp: string }
  | { kind: 'ice-candidate'; candidate: SerializableIceCandidate };

export type ClientToServerMessage =
  | { type: 'create-room'; nickname: string }
  | { type: 'join-room'; code: string; nickname: string }
  | { type: 'join-room'; roomId: string; inviteToken: string; nickname: string }
  | { type: 'resume-session'; resumeToken: string }
  | { type: 'leave-room' }
  | { type: 'signal'; targetId: string; data: SignalPayload }
  | { type: 'set-active-preset'; presetId: string }
  | { type: 'set-active-quality'; quality: ActiveQuality }
  | { type: 'chat-message'; id: string; text: string; imageDataUrl?: string }
  | { type: 'ping' };

export type ServerErrorCode =
  | 'INVALID_MESSAGE'
  | 'MESSAGE_TOO_LARGE'
  | 'RATE_LIMITED'
  | 'NOT_IN_ROOM'
  | 'ROOM_NOT_FOUND'
  | 'ROOM_FULL'
  | 'FORBIDDEN'
  | 'CONFLICT'
  | 'INTERNAL_ERROR';

export type RoomCloseReason = 'host-left' | 'host-disconnected' | 'expired' | 'server-shutdown';

export type ServerToClientMessage =
  | { type: 'room-created'; room: Room; selfId: string; resumeToken: string; inviteToken: string; iceServers: IceServerConfig[] }
  | { type: 'room-joined'; room: Room; selfId: string; resumeToken: string; iceServers: IceServerConfig[] }
  | { type: 'session-resumed'; room: Room; selfId: string; iceServers: IceServerConfig[] }
  | { type: 'ice-servers'; iceServers: IceServerConfig[] }
  | { type: 'room-updated'; room: Room }
  | { type: 'peer-joined'; participant: Room['participants'][number] }
  | { type: 'peer-left'; participantId: string }
  | { type: 'participant-connection'; participantId: string; connected: boolean }
  | { type: 'room-closed'; reason: RoomCloseReason }
  | { type: 'signal'; fromId: string; data: SignalPayload }
  | { type: 'chat-message'; message: ChatRecord }
  | { type: 'chat-history'; messages: ChatRecord[] }
  | { type: 'error'; code: ServerErrorCode; message: string }
  | { type: 'pong'; serverTime: number };

export type ProtocolParseResult =
  | { ok: true; value: ClientToServerMessage }
  | { ok: false; code: ServerErrorCode; message: string };

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: UnknownRecord, allowed: readonly string[]): boolean {
  const allowedSet = new Set(allowed);
  return Object.keys(value).every((key) => allowedSet.has(key));
}

function normalizedNickname(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const nickname = value.trim();
  if (nickname.length < 1 || nickname.length > MAX_NICKNAME_LENGTH) return null;
  if (/\p{Cc}/u.test(nickname)) return null;
  return nickname;
}

function isParticipantId(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function isMessageId(value: unknown): value is string {
  return isParticipantId(value);
}

function isResolutionTier(value: unknown): value is ResolutionTier {
  return value === 360 || value === 480 || value === 720 || value === 1080 || value === 1440;
}

function isFpsOption(value: unknown): value is FpsOption {
  return value === 15 || value === 30 || value === 45 || value === 60;
}

function parseQuality(value: unknown): ActiveQuality | null {
  if (!isRecord(value) || !hasOnlyKeys(value, ['resolutionTier', 'fps', 'prioritize', 'mode'])) return null;
  if (!isResolutionTier(value.resolutionTier) || !isFpsOption(value.fps)) return null;
  if (value.prioritize !== 'clarity' && value.prioritize !== 'smoothness') return null;
  if (value.mode !== 'manual' && value.mode !== 'auto') return null;
  return {
    resolutionTier: value.resolutionTier,
    fps: value.fps,
    prioritize: value.prioritize,
    mode: value.mode,
  };
}

function parseIceCandidate(value: unknown): SerializableIceCandidate | null {
  if (!isRecord(value) || !hasOnlyKeys(value, ['candidate', 'sdpMid', 'sdpMLineIndex', 'usernameFragment'])) return null;
  if (typeof value.candidate !== 'string' || value.candidate.length > MAX_ICE_CANDIDATE_LENGTH) return null;
  if (value.sdpMid !== null && typeof value.sdpMid !== 'string') return null;
  if (value.sdpMLineIndex !== null && (typeof value.sdpMLineIndex !== 'number' || !Number.isInteger(value.sdpMLineIndex) || value.sdpMLineIndex < 0)) return null;
  if (value.usernameFragment !== undefined && value.usernameFragment !== null && typeof value.usernameFragment !== 'string') return null;
  return {
    candidate: value.candidate,
    sdpMid: value.sdpMid,
    sdpMLineIndex: value.sdpMLineIndex,
    ...(value.usernameFragment !== undefined ? { usernameFragment: value.usernameFragment } : {}),
  };
}

function parseSignal(value: unknown): SignalPayload | null {
  if (!isRecord(value) || typeof value.kind !== 'string') return null;
  if (value.kind === 'offer' || value.kind === 'answer') {
    if (!hasOnlyKeys(value, ['kind', 'sdp']) || typeof value.sdp !== 'string' || value.sdp.length < 1 || value.sdp.length > MAX_SDP_LENGTH) return null;
    return { kind: value.kind, sdp: value.sdp };
  }
  if (value.kind === 'ice-candidate' && hasOnlyKeys(value, ['kind', 'candidate'])) {
    const candidate = parseIceCandidate(value.candidate);
    return candidate ? { kind: 'ice-candidate', candidate } : null;
  }
  return null;
}

function parseParticipant(value: unknown): Room['participants'][number] | null {
  if (!isRecord(value) || !hasOnlyKeys(value, ['id', 'nickname', 'roleId', 'appliedPresetId'])) return null;
  const nickname = normalizedNickname(value.nickname);
  if (!isParticipantId(value.id) || !nickname || (value.roleId !== 'host' && value.roleId !== 'guest' && value.roleId !== 'viewer')) return null;
  if (value.appliedPresetId !== undefined && (typeof value.appliedPresetId !== 'string' || !BUILTIN_PRESETS.some((preset) => preset.id === value.appliedPresetId))) return null;
  return {
    id: value.id,
    nickname,
    roleId: value.roleId,
    ...(typeof value.appliedPresetId === 'string' ? { appliedPresetId: value.appliedPresetId } : {}),
  };
}

function parseRoom(value: unknown): Room | null {
  if (!isRecord(value) || !hasOnlyKeys(value, ['id', 'code', 'hostId', 'participants', 'activePresetId', 'activeQuality', 'createdAt'])) return null;
  if (!isParticipantId(value.id) || !isParticipantId(value.hostId) || typeof value.code !== 'string' || !/^[A-HJ-NP-Z2-9]{6}$/.test(value.code)) return null;
  if (!Array.isArray(value.participants) || value.participants.length < 1 || value.participants.length > 16) return null;
  const participants = value.participants.map(parseParticipant);
  if (participants.some((participant) => participant === null)) return null;
  if (!participants.some((participant) => participant !== null && participant.id === value.hostId && participant.roleId === 'host')) return null;
  if (typeof value.createdAt !== 'string' || !Number.isFinite(Date.parse(value.createdAt))) return null;
  if (value.activePresetId !== undefined && (typeof value.activePresetId !== 'string' || !BUILTIN_PRESETS.some((preset) => preset.id === value.activePresetId))) return null;
  const quality = value.activeQuality === undefined ? undefined : parseQuality(value.activeQuality);
  if (value.activeQuality !== undefined && !quality) return null;
  return {
    id: value.id,
    code: value.code,
    hostId: value.hostId,
    participants: participants.filter((participant): participant is Room['participants'][number] => participant !== null),
    ...(typeof value.activePresetId === 'string' ? { activePresetId: value.activePresetId } : {}),
    ...(quality ? { activeQuality: quality } : {}),
    createdAt: value.createdAt,
  };
}

function parseIceServers(value: unknown): IceServerConfig[] | null {
  if (!Array.isArray(value) || value.length > 8) return null;
  const servers: IceServerConfig[] = [];
  for (const candidate of value) {
    if (!isRecord(candidate) || !hasOnlyKeys(candidate, ['urls', 'username', 'credential']) || !Array.isArray(candidate.urls) || candidate.urls.length < 1 || candidate.urls.length > 8) return null;
    if (!candidate.urls.every((url) => typeof url === 'string' && /^(?:stun|turn|turns):/.test(url) && url.length <= 512)) return null;
    if (candidate.username !== undefined && (typeof candidate.username !== 'string' || candidate.username.length > 256)) return null;
    if (candidate.credential !== undefined && (typeof candidate.credential !== 'string' || candidate.credential.length > 512)) return null;
    servers.push({
      urls: candidate.urls,
      ...(typeof candidate.username === 'string' ? { username: candidate.username } : {}),
      ...(typeof candidate.credential === 'string' ? { credential: candidate.credential } : {}),
    });
  }
  return servers;
}

function parseChatRecord(value: unknown): ChatRecord | null {
  if (!isRecord(value) || !hasOnlyKeys(value, ['id', 'participantId', 'nickname', 'text', 'imageDataUrl', 'ts'])) return null;
  const nickname = normalizedNickname(value.nickname);
  if (!isMessageId(value.id) || !isParticipantId(value.participantId) || !nickname) return null;
  if (typeof value.text !== 'string' || value.text.length > MAX_CHAT_TEXT_LENGTH || typeof value.ts !== 'number' || !Number.isFinite(value.ts)) return null;
  if (value.imageDataUrl !== undefined && (typeof value.imageDataUrl !== 'string' || value.imageDataUrl.length > MAX_CHAT_IMAGE_LENGTH || !value.imageDataUrl.startsWith('data:image/jpeg;base64,'))) return null;
  return {
    id: value.id,
    participantId: value.participantId,
    nickname,
    text: value.text,
    ...(typeof value.imageDataUrl === 'string' ? { imageDataUrl: value.imageDataUrl } : {}),
    ts: value.ts,
  };
}

function invalid(message: string): ProtocolParseResult {
  return { ok: false, code: 'INVALID_MESSAGE', message };
}

export function parseClientMessage(raw: string): ProtocolParseResult {
  if (new TextEncoder().encode(raw).byteLength > MAX_SIGNALING_MESSAGE_BYTES) {
    return { ok: false, code: 'MESSAGE_TOO_LARGE', message: 'Signaling message is too large.' };
  }

  let decoded: unknown;
  try {
    decoded = JSON.parse(raw) as unknown;
  } catch (error: unknown) {
    const detail = error instanceof SyntaxError ? error.message : 'Unknown JSON parse error';
    return invalid(`Malformed JSON: ${detail}`);
  }

  if (!isRecord(decoded) || typeof decoded.type !== 'string') return invalid('Message must be an object with a string type.');

  switch (decoded.type) {
    case 'create-room': {
      if (!hasOnlyKeys(decoded, ['type', 'nickname'])) return invalid('create-room contains unsupported fields.');
      const nickname = normalizedNickname(decoded.nickname);
      return nickname ? { ok: true, value: { type: 'create-room', nickname } } : invalid('Nickname is required and must be 1-40 printable characters.');
    }
    case 'join-room': {
      const nickname = normalizedNickname(decoded.nickname);
      if (!nickname) return invalid('Nickname is required and must be 1-40 printable characters.');
      if (hasOnlyKeys(decoded, ['type', 'code', 'nickname'])) {
        if (typeof decoded.code !== 'string') return invalid('Room code must contain exactly 6 supported characters.');
        const code = decoded.code.trim().toUpperCase();
        if (!/^[A-HJ-NP-Z2-9]{6}$/.test(code)) return invalid('Room code must contain exactly 6 supported characters.');
        return { ok: true, value: { type: 'join-room', code, nickname } };
      }
      if (hasOnlyKeys(decoded, ['type', 'roomId', 'inviteToken', 'nickname'])) {
        if (!isParticipantId(decoded.roomId)) return invalid('Room ID is invalid.');
        if (typeof decoded.inviteToken !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(decoded.inviteToken)) return invalid('Invite token is invalid.');
        return { ok: true, value: { type: 'join-room', roomId: decoded.roomId, inviteToken: decoded.inviteToken, nickname } };
      }
      return invalid('join-room contains unsupported fields.');
    }
    case 'leave-room':
    case 'ping':
      return hasOnlyKeys(decoded, ['type']) ? { ok: true, value: { type: decoded.type } } : invalid(`${decoded.type} contains unsupported fields.`);
    case 'resume-session':
      if (!hasOnlyKeys(decoded, ['type', 'resumeToken']) || typeof decoded.resumeToken !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(decoded.resumeToken)) {
        return invalid('Resume token is invalid.');
      }
      return { ok: true, value: { type: 'resume-session', resumeToken: decoded.resumeToken } };
    case 'signal': {
      if (!hasOnlyKeys(decoded, ['type', 'targetId', 'data']) || !isParticipantId(decoded.targetId)) return invalid('signal targetId is invalid.');
      const data = parseSignal(decoded.data);
      return data ? { ok: true, value: { type: 'signal', targetId: decoded.targetId, data } } : invalid('signal payload is invalid.');
    }
    case 'set-active-preset': {
      if (!hasOnlyKeys(decoded, ['type', 'presetId']) || typeof decoded.presetId !== 'string') return invalid('Preset payload is invalid.');
      if (!BUILTIN_PRESETS.some((preset) => preset.id === decoded.presetId)) return invalid('Unknown preset.');
      return { ok: true, value: { type: 'set-active-preset', presetId: decoded.presetId } };
    }
    case 'set-active-quality': {
      if (!hasOnlyKeys(decoded, ['type', 'quality'])) return invalid('Quality payload is invalid.');
      const quality = parseQuality(decoded.quality);
      return quality ? { ok: true, value: { type: 'set-active-quality', quality } } : invalid('Quality payload is invalid.');
    }
    case 'chat-message': {
      if (!hasOnlyKeys(decoded, ['type', 'id', 'text', 'imageDataUrl']) || !isMessageId(decoded.id)) return invalid('Chat message ID is invalid.');
      if (typeof decoded.text !== 'string' || decoded.text.length > MAX_CHAT_TEXT_LENGTH || /\p{Cc}/u.test(decoded.text)) return invalid('Chat text is invalid.');
      if (decoded.imageDataUrl !== undefined && (
        typeof decoded.imageDataUrl !== 'string'
        || decoded.imageDataUrl.length > MAX_CHAT_IMAGE_LENGTH
        || !decoded.imageDataUrl.startsWith('data:image/jpeg;base64,')
      )) return invalid('Chat image is invalid.');
      if (!decoded.text.trim() && decoded.imageDataUrl === undefined) return invalid('Chat message cannot be empty.');
      return {
        ok: true,
        value: {
          type: 'chat-message',
          id: decoded.id,
          text: decoded.text.trim(),
          ...(typeof decoded.imageDataUrl === 'string' ? { imageDataUrl: decoded.imageDataUrl } : {}),
        },
      };
    }
    default:
      return invalid(`Unsupported message type: ${decoded.type}.`);
  }
}

export function parseServerMessage(raw: string): ServerToClientMessage | null {
  if (new TextEncoder().encode(raw).byteLength > MAX_SIGNALING_MESSAGE_BYTES) return null;
  let decoded: unknown;
  try {
    decoded = JSON.parse(raw) as unknown;
  } catch (error: unknown) {
    console.warn('[protocol] Could not parse server JSON.', error);
    return null;
  }
  if (!isRecord(decoded) || typeof decoded.type !== 'string') return null;
  switch (decoded.type) {
    case 'room-created':
    case 'room-joined': {
      const keys = decoded.type === 'room-created'
        ? ['type', 'room', 'selfId', 'resumeToken', 'inviteToken', 'iceServers']
        : ['type', 'room', 'selfId', 'resumeToken', 'iceServers'];
      if (!hasOnlyKeys(decoded, keys) || !isParticipantId(decoded.selfId) || typeof decoded.resumeToken !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(decoded.resumeToken)) return null;
      const room = parseRoom(decoded.room);
      const iceServers = parseIceServers(decoded.iceServers);
      if (!room || !iceServers) return null;
      if (decoded.type === 'room-created') {
        if (typeof decoded.inviteToken !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(decoded.inviteToken)) return null;
        return { type: 'room-created', room, selfId: decoded.selfId, resumeToken: decoded.resumeToken, inviteToken: decoded.inviteToken, iceServers };
      }
      return { type: 'room-joined', room, selfId: decoded.selfId, resumeToken: decoded.resumeToken, iceServers };
    }
    case 'session-resumed': {
      if (!hasOnlyKeys(decoded, ['type', 'room', 'selfId', 'iceServers']) || !isParticipantId(decoded.selfId)) return null;
      const room = parseRoom(decoded.room);
      const iceServers = parseIceServers(decoded.iceServers);
      return room && iceServers ? { type: 'session-resumed', room, selfId: decoded.selfId, iceServers } : null;
    }
    case 'ice-servers': {
      if (!hasOnlyKeys(decoded, ['type', 'iceServers'])) return null;
      const iceServers = parseIceServers(decoded.iceServers);
      return iceServers ? { type: 'ice-servers', iceServers } : null;
    }
    case 'room-updated': {
      if (!hasOnlyKeys(decoded, ['type', 'room'])) return null;
      const room = parseRoom(decoded.room);
      return room ? { type: 'room-updated', room } : null;
    }
    case 'peer-joined': {
      if (!hasOnlyKeys(decoded, ['type', 'participant'])) return null;
      const participant = parseParticipant(decoded.participant);
      return participant ? { type: 'peer-joined', participant } : null;
    }
    case 'peer-left':
      return hasOnlyKeys(decoded, ['type', 'participantId']) && isParticipantId(decoded.participantId) ? { type: 'peer-left', participantId: decoded.participantId } : null;
    case 'participant-connection':
      return hasOnlyKeys(decoded, ['type', 'participantId', 'connected']) && isParticipantId(decoded.participantId) && typeof decoded.connected === 'boolean'
        ? { type: 'participant-connection', participantId: decoded.participantId, connected: decoded.connected }
        : null;
    case 'room-closed': {
      const reasons: RoomCloseReason[] = ['host-left', 'host-disconnected', 'expired', 'server-shutdown'];
      return hasOnlyKeys(decoded, ['type', 'reason']) && typeof decoded.reason === 'string' && reasons.includes(decoded.reason as RoomCloseReason)
        ? { type: 'room-closed', reason: decoded.reason as RoomCloseReason }
        : null;
    }
    case 'signal': {
      if (!hasOnlyKeys(decoded, ['type', 'fromId', 'data']) || !isParticipantId(decoded.fromId)) return null;
      const data = parseSignal(decoded.data);
      return data ? { type: 'signal', fromId: decoded.fromId, data } : null;
    }
    case 'chat-message': {
      if (!hasOnlyKeys(decoded, ['type', 'message'])) return null;
      const message = parseChatRecord(decoded.message);
      return message ? { type: 'chat-message', message } : null;
    }
    case 'chat-history': {
      if (!hasOnlyKeys(decoded, ['type', 'messages']) || !Array.isArray(decoded.messages) || decoded.messages.length > 100) return null;
      const messages = decoded.messages.map(parseChatRecord);
      return messages.every((message): message is ChatRecord => message !== null) ? { type: 'chat-history', messages } : null;
    }
    case 'error': {
      const codes: ServerErrorCode[] = ['INVALID_MESSAGE', 'MESSAGE_TOO_LARGE', 'RATE_LIMITED', 'NOT_IN_ROOM', 'ROOM_NOT_FOUND', 'ROOM_FULL', 'FORBIDDEN', 'CONFLICT', 'INTERNAL_ERROR'];
      return hasOnlyKeys(decoded, ['type', 'code', 'message']) && typeof decoded.code === 'string' && codes.includes(decoded.code as ServerErrorCode) && typeof decoded.message === 'string' && decoded.message.length <= 500
        ? { type: 'error', code: decoded.code as ServerErrorCode, message: decoded.message }
        : null;
    }
    case 'pong':
      return hasOnlyKeys(decoded, ['type', 'serverTime']) && typeof decoded.serverTime === 'number' && Number.isFinite(decoded.serverTime)
        ? { type: 'pong', serverTime: decoded.serverTime }
        : null;
    default:
      return null;
  }
}
