import { createHash, randomBytes, randomInt, randomUUID, timingSafeEqual } from 'crypto';
import type { ActiveQuality, Participant, RoleId, Room } from './types';
import type { ServerErrorCode } from './types';
import type { ChatRecord } from '../../shared/protocol';

export interface RoomRegistryOptions {
  maxParticipants: number;
  roomTtlMs: number;
}

export interface LeaveRoomResult {
  room: Room | null;
  closedRoom?: Room;
  wasHost: boolean;
}

export interface JoinRoomError {
  error: string;
  code: Extract<ServerErrorCode, 'ROOM_NOT_FOUND' | 'ROOM_FULL'>;
}

const DEFAULT_OPTIONS: RoomRegistryOptions = {
  maxParticipants: 4,
  roomTtlMs: 6 * 60 * 60 * 1000,
};

/** In-memory room state. Operational limits are explicit and testable. */
export class RoomRegistry {
  private readonly roomsById = new Map<string, Room>();
  private readonly roomsByCode = new Map<string, string>();
  private readonly inviteHashesByRoomId = new Map<string, Buffer>();
  private readonly chatByRoomId = new Map<string, ChatRecord[]>();
  private readonly options: RoomRegistryOptions;

  constructor(options: Partial<RoomRegistryOptions> = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  private generateCode(): string {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code: string;
    do {
      code = Array.from({ length: 6 }, () => alphabet[randomInt(alphabet.length)]).join('');
    } while (this.roomsByCode.has(code));
    return code;
  }

  createRoom(hostNickname: string): { room: Room; hostParticipant: Participant; inviteToken: string } {
    const hostParticipant: Participant = {
      id: randomUUID(),
      nickname: hostNickname,
      roleId: 'host',
    };
    const room: Room = {
      id: randomUUID(),
      code: this.generateCode(),
      hostId: hostParticipant.id,
      participants: [hostParticipant],
      activePresetId: 'watch-together',
      createdAt: new Date().toISOString(),
    };
    this.roomsById.set(room.id, room);
    this.roomsByCode.set(room.code, room.id);
    const inviteToken = randomBytes(32).toString('base64url');
    this.inviteHashesByRoomId.set(room.id, this.hashInviteToken(inviteToken));
    this.chatByRoomId.set(room.id, []);
    return { room, hostParticipant, inviteToken };
  }

  joinRoom(code: string, nickname: string): { room: Room; participant: Participant } | JoinRoomError {
    const roomId = this.roomsByCode.get(code.toUpperCase());
    if (!roomId) return { error: 'Room not found or already closed.', code: 'ROOM_NOT_FOUND' };
    return this.joinRoomById(roomId, nickname);
  }

  joinRoomByInvite(roomId: string, inviteToken: string, nickname: string): { room: Room; participant: Participant } | JoinRoomError {
    const expectedHash = this.inviteHashesByRoomId.get(roomId);
    const suppliedHash = this.hashInviteToken(inviteToken);
    if (!expectedHash || !timingSafeEqual(expectedHash, suppliedHash)) {
      return { error: 'Invitation is invalid, expired, or the room is already closed.', code: 'ROOM_NOT_FOUND' };
    }
    return this.joinRoomById(roomId, nickname);
  }

  private joinRoomById(roomId: string, nickname: string): { room: Room; participant: Participant } | JoinRoomError {
    const room = this.roomsById.get(roomId);
    if (!room) return { error: 'Room not found or already closed.', code: 'ROOM_NOT_FOUND' };
    if (room.participants.length >= this.options.maxParticipants) {
      return { error: `Room is full (maximum ${this.options.maxParticipants} participants).`, code: 'ROOM_FULL' };
    }

    const roleId: RoleId = 'guest';
    const participant: Participant = { id: randomUUID(), nickname, roleId };
    room.participants.push(participant);
    return { room, participant };
  }

  leaveRoom(roomId: string, participantId: string): LeaveRoomResult {
    const room = this.roomsById.get(roomId);
    if (!room) return { room: null, wasHost: false };
    const wasHost = room.hostId === participantId;

    if (wasHost) {
      this.deleteRoom(room);
      return { room: null, closedRoom: room, wasHost: true };
    }

    room.participants = room.participants.filter((participant) => participant.id !== participantId);
    if (room.participants.length === 0) {
      this.deleteRoom(room);
      return { room: null, closedRoom: room, wasHost: false };
    }
    return { room, wasHost: false };
  }

  closeRoom(roomId: string): Room | undefined {
    const room = this.roomsById.get(roomId);
    if (room) this.deleteRoom(room);
    return room;
  }

  sweepExpired(now = Date.now()): Room[] {
    const expired: Room[] = [];
    for (const room of this.roomsById.values()) {
      if (now - Date.parse(room.createdAt) >= this.options.roomTtlMs) {
        expired.push(room);
        this.deleteRoom(room);
      }
    }
    return expired;
  }

  getRoom(roomId: string): Room | undefined {
    return this.roomsById.get(roomId);
  }

  get roomCount(): number {
    return this.roomsById.size;
  }

  setActivePreset(roomId: string, presetId: string): Room | undefined {
    const room = this.roomsById.get(roomId);
    if (room) room.activePresetId = presetId;
    return room;
  }

  setActiveQuality(roomId: string, quality: ActiveQuality): Room | undefined {
    const room = this.roomsById.get(roomId);
    if (room) room.activeQuality = quality;
    return room;
  }

  appendChatMessage(roomId: string, message: ChatRecord, now = Date.now()): { message: ChatRecord; isNew: boolean } | undefined {
    if (!this.roomsById.has(roomId)) return undefined;
    const history = this.pruneChatHistory(roomId, now);
    const existing = history.find((candidate) => candidate.id === message.id);
    if (existing) return { message: existing, isNew: false };
    history.push(message);
    if (history.length > 100) history.splice(0, history.length - 100);
    return { message, isNew: true };
  }

  getChatHistory(roomId: string, now = Date.now()): ChatRecord[] {
    return [...this.pruneChatHistory(roomId, now)];
  }

  private deleteRoom(room: Room): void {
    this.roomsById.delete(room.id);
    this.roomsByCode.delete(room.code);
    this.inviteHashesByRoomId.delete(room.id);
    this.chatByRoomId.delete(room.id);
  }

  private hashInviteToken(token: string): Buffer {
    return createHash('sha256').update(token).digest();
  }

  private pruneChatHistory(roomId: string, now: number): ChatRecord[] {
    const history = this.chatByRoomId.get(roomId) ?? [];
    const minimumTimestamp = now - 60 * 60_000;
    const retained = history.filter((message) => message.ts >= minimumTimestamp);
    this.chatByRoomId.set(roomId, retained);
    return retained;
  }
}

export const roomRegistry = new RoomRegistry();
