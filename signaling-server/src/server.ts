import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'http';
import { readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { extname, isAbsolute, join, relative } from 'path';
import { createHash, createHmac, randomBytes } from 'crypto';
import { WebSocketServer, WebSocket, type RawData } from 'ws';
import { MAX_SIGNALING_MESSAGE_BYTES, parseClientMessage, type IceServerConfig } from '../../shared/protocol';
import { RoomRegistry } from './rooms';
import type { Room, RoomCloseReason, ServerErrorCode, ServerToClientMessage } from './types';

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

export interface SignalingServerOptions {
  port?: number;
  staticDir?: string;
  allowedOrigins?: string[];
  registry?: RoomRegistry;
  messageRateLimitPerMinute?: number;
  roomSweepIntervalMs?: number;
  reconnectGraceMs?: number;
  stunUrls?: string[];
  turnUrls?: string[];
  turnSharedSecret?: string;
  turnCredentialTtlSeconds?: number;
}

interface ConnState {
  ws: WebSocket;
  roomId?: string;
  participantId?: string;
  sessionHash?: string;
  isAlive: boolean;
  rateWindowStartedAt: number;
  rateWindowCount: number;
}

interface ResumeSession {
  hash: string;
  roomId: string;
  participantId: string;
  expirationTimer: ReturnType<typeof setTimeout> | null;
}

export interface WatchTogetherServer {
  httpServer: Server;
  wss: WebSocketServer;
  registry: RoomRegistry;
  start: () => Promise<number>;
  stop: (reason?: RoomCloseReason) => Promise<void>;
}

function log(level: 'info' | 'warn' | 'error', component: string, action: string, details: Record<string, unknown> = {}): void {
  const entry = JSON.stringify({ timestamp: new Date().toISOString(), level, component, action, ...details });
  if (level === 'error') console.error(entry);
  else if (level === 'warn') console.warn(entry);
  else console.log(entry);
}

function normalizeOrigin(value: string | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  if (trimmed === 'null') return 'null';
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') return parsed.origin;
    if (parsed.protocol === 'tauri:' && parsed.hostname === 'localhost' && !parsed.port) return 'tauri://localhost';
  } catch {
    return null;
  }
  return null;
}

function requestPath(request: IncomingMessage): string {
  try {
    return new URL(request.url ?? '/', 'http://localhost').pathname;
  } catch {
    return '[invalid]';
  }
}

function resolveStaticDir(explicit?: string): string {
  if (explicit) return explicit;
  if (process.env.STATIC_DIR) return process.env.STATIC_DIR;
  const candidates = [
    join(process.cwd(), '..', 'desktop-client', 'dist'),
    join(__dirname, '..', '..', 'desktop-client', 'dist'),
    join(__dirname, '..', '..', '..', '..', 'desktop-client', 'dist'),
  ];
  return candidates.find((candidate) => existsSync(candidate)) ?? candidates[0];
}

function applySecurityHeaders(res: ServerResponse): void {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Permissions-Policy', 'camera=(), geolocation=(), payment=(), usb=()');
}

async function serveStatic(staticDir: string, req: IncomingMessage, res: ServerResponse): Promise<void> {
  applySecurityHeaders(res);
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { Allow: 'GET, HEAD' });
    res.end();
    return;
  }
  if (!existsSync(staticDir)) {
    res.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Frontend build not found. Build desktop-client or configure STATIC_DIR.');
    return;
  }

  let pathname: string;
  try {
    pathname = decodeURIComponent((req.url ?? '/').split('?')[0]);
  } catch (error: unknown) {
    log('warn', 'http', 'invalid-url-encoding', { error: error instanceof Error ? error.message : String(error) });
    res.writeHead(400);
    res.end('Invalid URL.');
    return;
  }
  const safePath = pathname === '/' ? 'index.html' : pathname.replace(/^[/\\]+/, '');
  const filePath = join(staticDir, safePath);
  const pathFromStaticDir = relative(staticDir, filePath);
  if (pathFromStaticDir.startsWith('..') || isAbsolute(pathFromStaticDir)) {
    res.writeHead(403);
    res.end();
    return;
  }

  try {
    const data = await readFile(filePath);
    res.writeHead(200, { 'Content-Type': MIME_TYPES[extname(filePath)] ?? 'application/octet-stream' });
    res.end(req.method === 'HEAD' ? undefined : data);
  } catch (error: unknown) {
    if (pathname.startsWith('/api/')) {
      res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: 'Not found' }));
      return;
    }
    try {
      const data = await readFile(join(staticDir, 'index.html'));
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(req.method === 'HEAD' ? undefined : data);
    } catch (fallbackError: unknown) {
      log('warn', 'http', 'static-read-failed', {
        path: pathFromStaticDir,
        error: error instanceof Error ? error.message : String(error),
        fallbackError: fallbackError instanceof Error ? fallbackError.message : String(fallbackError),
      });
      res.writeHead(404);
      res.end('Not found.');
    }
  }
}

function rawDataToString(raw: RawData): string {
  if (typeof raw === 'string') return raw;
  if (raw instanceof ArrayBuffer) return Buffer.from(raw).toString('utf8');
  if (Array.isArray(raw)) return Buffer.concat(raw).toString('utf8');
  return raw.toString('utf8');
}

export function createWatchTogetherServer(options: SignalingServerOptions = {}): WatchTogetherServer {
  const registry = options.registry ?? new RoomRegistry({
    maxParticipants: Number(process.env.MAX_PARTICIPANTS || 4),
    roomTtlMs: Number(process.env.ROOM_TTL_MS || 6 * 60 * 60_000),
  });
  const staticDir = resolveStaticDir(options.staticDir);
  const port = options.port ?? Number(process.env.PORT || 8787);
  const appVersion = process.env.npm_package_version ?? '0.2.0';
  const rateLimit = options.messageRateLimitPerMinute ?? Number(process.env.MESSAGE_RATE_LIMIT_PER_MINUTE || 180);
  const reconnectGraceMs = options.reconnectGraceMs ?? Number(process.env.RECONNECT_GRACE_MS || 20_000);
  const stunUrls = options.stunUrls ?? (process.env.STUN_URLS ?? 'stun:stun.l.google.com:19302').split(',').map((url) => url.trim()).filter(Boolean);
  const turnUrls = options.turnUrls ?? (process.env.TURN_URLS ?? '').split(',').map((url) => url.trim()).filter(Boolean);
  const turnSharedSecret = options.turnSharedSecret ?? process.env.TURN_SHARED_SECRET;
  const turnCredentialTtlSeconds = options.turnCredentialTtlSeconds ?? Number(process.env.TURN_CREDENTIAL_TTL_SECONDS || 3600);
  const configuredOrigins = options.allowedOrigins ?? (process.env.ALLOWED_ORIGINS ?? '').split(',');
  const originValidationEnabled = configuredOrigins.some((origin) => origin.trim().length > 0);
  const allowedOrigins = new Set(configuredOrigins.map((origin) => normalizeOrigin(origin)).filter((origin): origin is string => origin !== null));
  const connections = new Map<WebSocket, ConnState>();
  const socketsByParticipant = new Map<string, WebSocket>();
  const sessionsByHash = new Map<string, ResumeSession>();
  const sessionHashByParticipant = new Map<string, string>();
  let stopping = false;

  function buildIceServers(participantId: string): IceServerConfig[] {
    const servers: IceServerConfig[] = stunUrls.length ? [{ urls: stunUrls }] : [];
    if (!turnSharedSecret || turnUrls.length === 0) return servers;
    const expires = Math.floor(Date.now() / 1000) + Math.max(300, Math.min(turnCredentialTtlSeconds, 86_400));
    const username = `${expires}:${participantId}`;
    const credential = createHmac('sha1', turnSharedSecret).update(username).digest('base64');
    servers.push({ urls: turnUrls, username, credential });
    return servers;
  }

  function send(ws: WebSocket, message: ServerToClientMessage): void {
    if (ws.readyState !== WebSocket.OPEN) return;
    try {
      ws.send(JSON.stringify(message));
    } catch (error: unknown) {
      log('warn', 'signaling', 'send-failed', { error: error instanceof Error ? error.message : String(error) });
    }
  }

  function sendError(ws: WebSocket, code: ServerErrorCode, message: string): void {
    send(ws, { type: 'error', code, message });
  }

  function broadcastToRoom(roomId: string, message: ServerToClientMessage, exceptParticipantId?: string): void {
    const room = registry.getRoom(roomId);
    if (!room) return;
    for (const participant of room.participants) {
      if (participant.id === exceptParticipantId) continue;
      const socket = socketsByParticipant.get(participant.id);
      if (socket) send(socket, message);
    }
  }

  function refreshRoomIceServers(room: Room): void {
    for (const participant of room.participants) {
      const socket = socketsByParticipant.get(participant.id);
      if (socket) send(socket, { type: 'ice-servers', iceServers: buildIceServers(participant.id) });
    }
  }

  function tokenHash(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  function createResumeSession(state: ConnState, roomId: string, participantId: string): string {
    const resumeToken = randomBytes(32).toString('base64url');
    const hash = tokenHash(resumeToken);
    const session: ResumeSession = { hash, roomId, participantId, expirationTimer: null };
    sessionsByHash.set(hash, session);
    sessionHashByParticipant.set(participantId, hash);
    state.sessionHash = hash;
    return resumeToken;
  }

  function detachSocket(participantId: string): void {
    socketsByParticipant.delete(participantId);
  }

  function clearResumeSession(participantId: string): void {
    const hash = sessionHashByParticipant.get(participantId);
    if (!hash) return;
    const session = sessionsByHash.get(hash);
    if (session?.expirationTimer) clearTimeout(session.expirationTimer);
    sessionsByHash.delete(hash);
    sessionHashByParticipant.delete(participantId);
  }

  function clearConnectionMembership(participantId: string): void {
    const socket = socketsByParticipant.get(participantId);
    if (socket) {
      const state = connections.get(socket);
      if (state?.participantId === participantId) {
        state.roomId = undefined;
        state.participantId = undefined;
        state.sessionHash = undefined;
      }
    }
    detachSocket(participantId);
  }

  function notifyClosedRoom(room: Room, reason: RoomCloseReason, exceptParticipantId?: string): void {
    for (const participant of room.participants) {
      if (participant.id !== exceptParticipantId) {
        const socket = socketsByParticipant.get(participant.id);
        if (socket) send(socket, { type: 'room-closed', reason });
      }
      clearResumeSession(participant.id);
      clearConnectionMembership(participant.id);
    }
  }

  function removeFromRoom(state: ConnState, reason: 'leave' | 'disconnect'): void {
    if (!state.roomId || !state.participantId) return;
    const roomId = state.roomId;
    const participantId = state.participantId;
    const result = registry.leaveRoom(roomId, participantId);

    if (result.closedRoom) {
      notifyClosedRoom(result.closedRoom, result.wasHost && reason === 'disconnect' ? 'host-disconnected' : 'host-left', participantId);
    } else if (result.room) {
      broadcastToRoom(roomId, { type: 'peer-left', participantId }, participantId);
      broadcastToRoom(roomId, { type: 'room-updated', room: result.room }, participantId);
    }
    clearResumeSession(participantId);
    detachSocket(participantId);
    state.roomId = undefined;
    state.participantId = undefined;
    state.sessionHash = undefined;
  }

  function expireDisconnectedSession(session: ResumeSession): void {
    if (!sessionsByHash.has(session.hash)) return;
    sessionsByHash.delete(session.hash);
    sessionHashByParticipant.delete(session.participantId);
    const result = registry.leaveRoom(session.roomId, session.participantId);
    if (result.closedRoom) {
      notifyClosedRoom(result.closedRoom, result.wasHost ? 'host-disconnected' : 'expired', session.participantId);
    } else if (result.room) {
      broadcastToRoom(session.roomId, { type: 'peer-left', participantId: session.participantId }, session.participantId);
      broadcastToRoom(session.roomId, { type: 'room-updated', room: result.room }, session.participantId);
    }
    log('info', 'room', 'reconnect-grace-expired', { roomId: session.roomId.slice(0, 8), participantId: session.participantId.slice(0, 8) });
  }

  function scheduleDisconnect(state: ConnState): void {
    if (!state.roomId || !state.participantId || !state.sessionHash) return;
    const session = sessionsByHash.get(state.sessionHash);
    if (!session) {
      removeFromRoom(state, 'disconnect');
      return;
    }
    detachSocket(state.participantId);
    broadcastToRoom(state.roomId, { type: 'participant-connection', participantId: state.participantId, connected: false }, state.participantId);
    if (session.expirationTimer) clearTimeout(session.expirationTimer);
    session.expirationTimer = setTimeout(() => expireDisconnectedSession(session), reconnectGraceMs);
    session.expirationTimer.unref();
  }

  function consumeRateLimit(state: ConnState): boolean {
    const now = Date.now();
    if (now - state.rateWindowStartedAt >= 60_000) {
      state.rateWindowStartedAt = now;
      state.rateWindowCount = 0;
    }
    state.rateWindowCount += 1;
    return state.rateWindowCount <= rateLimit;
  }

  const httpServer = createServer((req, res) => {
    if (req.url === '/healthz' || req.url === '/readyz') {
      const ready = !stopping && existsSync(join(staticDir, 'index.html'));
      const healthy = !stopping;
      const ok = req.url === '/readyz' ? ready : healthy;
      applySecurityHeaders(res);
      res.writeHead(ok ? 200 : 503, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({
        status: stopping ? 'stopping' : ok ? 'ok' : 'not-ready',
        version: appVersion,
        rooms: registry.roomCount,
        connections: connections.size,
      }));
      return;
    }
    void serveStatic(staticDir, req, res).catch((error: unknown) => {
      log('error', 'http', 'unhandled-request-error', { error: error instanceof Error ? error.message : String(error) });
      if (!res.headersSent) res.writeHead(500);
      res.end('Internal server error.');
    });
  });

  const wss = new WebSocketServer({
    server: httpServer,
    path: '/ws',
    maxPayload: MAX_SIGNALING_MESSAGE_BYTES,
    verifyClient: ({ origin, req }, callback) => {
      const normalizedOrigin = normalizeOrigin(origin);
      const path = requestPath(req);
      const allowed = !originValidationEnabled || (normalizedOrigin !== null && allowedOrigins.has(normalizedOrigin));
      if (allowed) {
        log('info', 'signaling', 'upgrade-accepted', { origin: normalizedOrigin, path });
        callback(true);
        return;
      }
      const reason = !origin ? 'missing-origin' : normalizedOrigin === null ? 'invalid-origin' : 'origin-not-allowed';
      log('warn', 'signaling', 'upgrade-rejected', { origin: normalizedOrigin ?? '[invalid]', path, reason });
      callback(false, 403, 'Origin not allowed.');
    },
  });

  httpServer.on('upgrade', (request) => {
    const path = requestPath(request);
    if (path === '/ws') return;
    log('warn', 'signaling', 'upgrade-rejected', {
      origin: normalizeOrigin(request.headers.origin) ?? (request.headers.origin ? '[invalid]' : null),
      path,
      reason: 'path-not-allowed',
    });
  });

  wss.on('connection', (ws, request) => {
    const connectionOrigin = normalizeOrigin(request.headers.origin);
    const connectionPath = requestPath(request);
    const state: ConnState = {
      ws,
      isAlive: true,
      rateWindowStartedAt: Date.now(),
      rateWindowCount: 0,
    };
    connections.set(ws, state);
    ws.on('pong', () => {
      state.isAlive = true;
    });

    ws.on('message', (raw) => {
      if (!consumeRateLimit(state)) {
        sendError(ws, 'RATE_LIMITED', 'Too many signaling messages. Slow down and retry.');
        return;
      }

      const parsed = parseClientMessage(rawDataToString(raw));
      if (!parsed.ok) {
        sendError(ws, parsed.code, parsed.message);
        return;
      }
      const message = parsed.value;

      switch (message.type) {
        case 'create-room': {
          if (state.roomId) {
            sendError(ws, 'CONFLICT', 'Leave the current room before creating another one.');
            return;
          }
          const { room, hostParticipant, inviteToken } = registry.createRoom(message.nickname);
          state.roomId = room.id;
          state.participantId = hostParticipant.id;
          socketsByParticipant.set(hostParticipant.id, ws);
          const resumeToken = createResumeSession(state, room.id, hostParticipant.id);
          send(ws, { type: 'room-created', room, selfId: hostParticipant.id, resumeToken, inviteToken, iceServers: buildIceServers(hostParticipant.id) });
          log('info', 'room', 'created', { roomId: room.id.slice(0, 8), participantId: hostParticipant.id.slice(0, 8) });
          return;
        }
        case 'join-room': {
          if (state.roomId) {
            sendError(ws, 'CONFLICT', 'Leave the current room before joining another one.');
            return;
          }
          const result = 'code' in message
            ? registry.joinRoom(message.code, message.nickname)
            : registry.joinRoomByInvite(message.roomId, message.inviteToken, message.nickname);
          if ('error' in result) {
            sendError(ws, result.code, result.error);
            return;
          }
          const { room, participant } = result;
          state.roomId = room.id;
          state.participantId = participant.id;
          socketsByParticipant.set(participant.id, ws);
          const resumeToken = createResumeSession(state, room.id, participant.id);
          send(ws, { type: 'room-joined', room, selfId: participant.id, resumeToken, iceServers: buildIceServers(participant.id) });
          send(ws, { type: 'chat-history', messages: registry.getChatHistory(room.id) });
          broadcastToRoom(room.id, { type: 'peer-joined', participant }, participant.id);
          broadcastToRoom(room.id, { type: 'room-updated', room }, participant.id);
          refreshRoomIceServers(room);
          log('info', 'room', 'joined', { roomId: room.id.slice(0, 8), participantId: participant.id.slice(0, 8) });
          return;
        }
        case 'resume-session': {
          if (state.roomId) {
            sendError(ws, 'CONFLICT', 'This connection is already attached to a room.');
            return;
          }
          const hash = tokenHash(message.resumeToken);
          const session = sessionsByHash.get(hash);
          const room = session ? registry.getRoom(session.roomId) : undefined;
          const participant = room?.participants.find((candidate) => candidate.id === session?.participantId);
          if (!session || !room || !participant) {
            sendError(ws, 'ROOM_NOT_FOUND', 'The reconnect session expired or the room was closed.');
            return;
          }
          if (session.expirationTimer) clearTimeout(session.expirationTimer);
          session.expirationTimer = null;
          const previousSocket = socketsByParticipant.get(session.participantId);
          if (previousSocket && previousSocket !== ws) {
            const previousState = connections.get(previousSocket);
            if (previousState) {
              previousState.roomId = undefined;
              previousState.participantId = undefined;
              previousState.sessionHash = undefined;
            }
            previousSocket.close(4001, 'Session resumed on another connection');
          }
          state.roomId = room.id;
          state.participantId = participant.id;
          state.sessionHash = hash;
          socketsByParticipant.set(participant.id, ws);
          send(ws, { type: 'session-resumed', room, selfId: participant.id, iceServers: buildIceServers(participant.id) });
          send(ws, { type: 'chat-history', messages: registry.getChatHistory(room.id) });
          broadcastToRoom(room.id, { type: 'participant-connection', participantId: participant.id, connected: true }, participant.id);
          log('info', 'room', 'session-resumed', { roomId: room.id.slice(0, 8), participantId: participant.id.slice(0, 8) });
          return;
        }
        case 'leave-room':
          removeFromRoom(state, 'leave');
          return;
        case 'signal': {
          if (!state.roomId || !state.participantId) {
            sendError(ws, 'NOT_IN_ROOM', 'Join a room before sending signals.');
            return;
          }
          const room = registry.getRoom(state.roomId);
          if (!room?.participants.some((participant) => participant.id === message.targetId)) {
            sendError(ws, 'FORBIDDEN', 'Signal target is not in your room.');
            return;
          }
          const targetSocket = socketsByParticipant.get(message.targetId);
          if (targetSocket) send(targetSocket, { type: 'signal', fromId: state.participantId, data: message.data });
          return;
        }
        case 'set-active-preset': {
          if (!state.roomId) {
            sendError(ws, 'NOT_IN_ROOM', 'Join a room before changing the preset.');
            return;
          }
          const currentRoom = registry.getRoom(state.roomId);
          if (!currentRoom || currentRoom.hostId !== state.participantId) {
            sendError(ws, 'FORBIDDEN', 'Only the host can change the active preset.');
            return;
          }
          const room = registry.setActivePreset(state.roomId, message.presetId);
          if (room) broadcastToRoom(room.id, { type: 'room-updated', room });
          return;
        }
        case 'set-active-quality': {
          if (!state.roomId) {
            sendError(ws, 'NOT_IN_ROOM', 'Join a room before changing stream quality.');
            return;
          }
          const currentRoom = registry.getRoom(state.roomId);
          if (!currentRoom || currentRoom.hostId !== state.participantId) {
            sendError(ws, 'FORBIDDEN', 'Only the host can change stream quality.');
            return;
          }
          const room = registry.setActiveQuality(state.roomId, message.quality);
          if (room) broadcastToRoom(room.id, { type: 'room-updated', room });
          return;
        }
        case 'chat-message': {
          if (!state.roomId || !state.participantId) {
            sendError(ws, 'NOT_IN_ROOM', 'Join a room before sending chat messages.');
            return;
          }
          const currentRoom = registry.getRoom(state.roomId);
          const participant = currentRoom?.participants.find((candidate) => candidate.id === state.participantId);
          if (!currentRoom || !participant) {
            sendError(ws, 'NOT_IN_ROOM', 'The room membership is no longer active.');
            return;
          }
          const result = registry.appendChatMessage(currentRoom.id, {
            id: message.id,
            participantId: participant.id,
            nickname: participant.nickname,
            text: message.text,
            ...(message.imageDataUrl ? { imageDataUrl: message.imageDataUrl } : {}),
            ts: Date.now(),
          });
          if (result?.isNew) broadcastToRoom(currentRoom.id, { type: 'chat-message', message: result.message });
          else if (result) send(ws, { type: 'chat-message', message: result.message });
          return;
        }
        case 'ping':
          send(ws, { type: 'pong', serverTime: Date.now() });
          return;
      }
    });

    ws.on('error', (error) => {
      log('warn', 'signaling', 'socket-error', { error: error.message });
    });
    ws.on('close', (code) => {
      log('info', 'signaling', 'socket-closed', { origin: connectionOrigin, path: connectionPath, code });
      if (!stopping) scheduleDisconnect(state);
      connections.delete(ws);
    });
  });

  wss.on('error', (error) => {
    log('error', 'signaling', 'server-error', { error: error.message });
  });
  httpServer.on('error', (error) => {
    log('error', 'http', 'server-error', { error: error.message });
  });

  const heartbeatTimer = setInterval(() => {
    for (const state of connections.values()) {
      if (!state.isAlive) {
        log('warn', 'signaling', 'heartbeat-timeout', { participantId: state.participantId?.slice(0, 8) });
        state.ws.terminate();
        continue;
      }
      state.isAlive = false;
      state.ws.ping();
    }
  }, 30_000);
  heartbeatTimer.unref();

  const roomSweepTimer = setInterval(() => {
    for (const room of registry.sweepExpired()) notifyClosedRoom(room, 'expired');
  }, options.roomSweepIntervalMs ?? 60_000);
  roomSweepTimer.unref();

  async function start(): Promise<number> {
    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error) => reject(error);
      httpServer.once('error', onError);
      httpServer.listen(port, '0.0.0.0', () => {
        httpServer.off('error', onError);
        resolve();
      });
    });
    const address = httpServer.address();
    const boundPort = typeof address === 'object' && address ? address.port : port;
    log('info', 'server', 'listening', { port: boundPort, staticDir, originValidation: originValidationEnabled, allowedOriginCount: allowedOrigins.size });
    return boundPort;
  }

  async function stop(reason: RoomCloseReason = 'server-shutdown'): Promise<void> {
    if (stopping) return;
    stopping = true;
    clearInterval(heartbeatTimer);
    clearInterval(roomSweepTimer);
    for (const session of sessionsByHash.values()) {
      if (session.expirationTimer) clearTimeout(session.expirationTimer);
    }
    const roomIds = new Set([...sessionsByHash.values()].map((session) => session.roomId));
    for (const roomId of roomIds) {
      const room = registry.closeRoom(roomId);
      if (room) notifyClosedRoom(room, reason);
    }
    for (const ws of connections.keys()) ws.close(1001, 'Server shutting down');
    await new Promise<void>((resolve) => {
      wss.close(() => resolve());
      setTimeout(resolve, 2_000).unref();
    });
    if (httpServer.listening) {
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    }
  }

  return { httpServer, wss, registry, start, stop };
}

if (require.main === module) {
  const application = createWatchTogetherServer();
  application.start().catch((error: unknown) => {
    log('error', 'server', 'startup-failed', { error: error instanceof Error ? error.message : String(error) });
    process.exitCode = 1;
  });
  const shutdown = (signal: NodeJS.Signals) => {
    log('info', 'server', 'shutdown-requested', { signal });
    application.stop().catch((error: unknown) => {
      log('error', 'server', 'shutdown-failed', { error: error instanceof Error ? error.message : String(error) });
      process.exitCode = 1;
    });
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}
