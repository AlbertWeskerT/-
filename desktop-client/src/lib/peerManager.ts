import type { ActiveQuality } from '../../../shared/types';
import { tierToMaxBitrateKbps } from '../../../shared/types';
import type { ServerToClientMessage, SignalPayload } from '../../../shared/protocol';
import type { SignalingClient } from './signalingClient';
import { calculateReconnectDelay, decideOfferCollision, IceCandidateQueue } from './webrtcState';
import { parseDrawingMessage, type DrawingMessage } from './drawingState';
import { parseControlSessionMessage, type ControlSessionMessage } from './controlState';
import { parseMediaSyncMessage, type MediaSyncMessage } from './mediaSync';

export interface RemoteStreamEvent {
  participantId: string;
  stream: MediaStream;
}

export interface NetworkStats {
  lossPct: number;
  rttMs: number;
  bitrateKbps: number;
  width?: number;
  height?: number;
  fps?: number;
  transport: 'direct' | 'relayed' | 'unknown';
}

export interface ChatMessage {
  id: string;
  participantId: string;
  nickname: string;
  text: string;
  imageDataUrl?: string;
  ts: number;
}

export type ControlMessage =
  | { kind: 'chat'; id: string; nickname: string; text: string; imageDataUrl?: string; ts: number }
  | { kind: 'voice-activity'; speaking: boolean }
  | DrawingMessage
  | ControlSessionMessage
  | MediaSyncMessage;

type MediaRole = 'microphone' | 'screenVideo' | 'screenAudio';

interface SenderSlots {
  microphone?: RTCRtpSender;
  screenVideo?: RTCRtpSender;
  screenAudio?: RTCRtpSender;
}

interface ReconnectState {
  attempts: number;
  restartInFlight: boolean;
  timer: ReturnType<typeof setTimeout> | null;
  disconnectedTimer: ReturnType<typeof setTimeout> | null;
}

interface PeerState {
  participantId: string;
  pc: RTCPeerConnection;
  polite: boolean;
  initiator: boolean;
  makingOffer: boolean;
  ignoreOffer: boolean;
  isSettingRemoteAnswerPending: boolean;
  pendingCandidates: IceCandidateQueue;
  senders: SenderSlots;
  remoteStream: MediaStream;
  dataChannel: RTCDataChannel | null;
  operationChain: Promise<void>;
  reconnect: ReconnectState;
  closed: boolean;
}

interface PeerManagerHandlers {
  onRemoteStream: (event: RemoteStreamEvent) => void;
  onChatMessage: (message: ChatMessage) => void;
  onControlMessage: (fromId: string, data: ControlMessage) => void;
  onPeerConnectionStateChange?: (participantId: string, state: RTCPeerConnectionState) => void;
  onPeerUnavailable?: (participantId: string) => void;
  onError?: (message: string, error?: unknown) => void;
}

interface RemoteInboundVideoStats {
  fractionLost?: number;
  roundTripTime?: number;
}

const MAX_RECONNECT_ATTEMPTS = 5;
const DISCONNECTED_GRACE_MS = 3_000;
const MAX_DATA_CHANNEL_BUFFER = 1_000_000;
const MAX_CHAT_IMAGE_LENGTH = 700_000;

function readRemoteInboundVideoStats(report: RTCStats): RemoteInboundVideoStats | null {
  if (report.type !== 'remote-inbound-rtp') return null;
  const record = report as RTCStats & Record<string, unknown>;
  const kind = record.kind ?? record.mediaType;
  if (kind !== 'video') return null;
  return {
    ...(typeof record.fractionLost === 'number' ? { fractionLost: record.fractionLost } : {}),
    ...(typeof record.roundTripTime === 'number' ? { roundTripTime: record.roundTripTime } : {}),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseControlMessage(raw: string): ControlMessage | null {
  let decoded: unknown;
  try {
    decoded = JSON.parse(raw) as unknown;
  } catch (error: unknown) {
    console.warn('[webrtc] Ignored malformed data-channel JSON.', error);
    return null;
  }
  if (!isRecord(decoded) || typeof decoded.kind !== 'string') return null;

  if (decoded.kind === 'chat') {
    if (
      typeof decoded.id !== 'string' || decoded.id.length > 64 ||
      typeof decoded.nickname !== 'string' || decoded.nickname.length > 40 ||
      typeof decoded.text !== 'string' || decoded.text.length > 500 ||
      typeof decoded.ts !== 'number' || !Number.isFinite(decoded.ts) ||
      (decoded.imageDataUrl !== undefined && (
        typeof decoded.imageDataUrl !== 'string' ||
        decoded.imageDataUrl.length > MAX_CHAT_IMAGE_LENGTH ||
        !decoded.imageDataUrl.startsWith('data:image/jpeg;base64,')
      ))
    ) return null;
    return {
      kind: 'chat',
      id: decoded.id,
      nickname: decoded.nickname,
      text: decoded.text,
      ...(typeof decoded.imageDataUrl === 'string' ? { imageDataUrl: decoded.imageDataUrl } : {}),
      ts: decoded.ts,
    };
  }
  if (decoded.kind === 'voice-activity' && typeof decoded.speaking === 'boolean') {
    return { kind: 'voice-activity', speaking: decoded.speaking };
  }
  const drawingMessage = parseDrawingMessage(decoded);
  if (drawingMessage) return drawingMessage;
  const controlSessionMessage = parseControlSessionMessage(decoded);
  if (controlSessionMessage) return controlSessionMessage;
  const mediaSyncMessage = parseMediaSyncMessage(decoded);
  if (mediaSyncMessage) return mediaSyncMessage;
  return null;
}

export class PeerManager {
  private readonly peers = new Map<string, PeerState>();
  private localMicTrack: MediaStreamTrack | null = null;
  private screenTrack: MediaStreamTrack | null = null;
  private screenAudioTrack: MediaStreamTrack | null = null;
  private currentQuality: ActiveQuality | null = null;
  private statsTimer: ReturnType<typeof setInterval> | null = null;
  private readonly previousOutboundBytes = new Map<string, { bytes: number; timestamp: number }>();
  private readonly unsubscribe: () => void;
  private destroyed = false;

  constructor(
    private readonly signaling: SignalingClient,
    private readonly selfId: string,
    private readonly handlers: PeerManagerHandlers,
    private iceServers: RTCIceServer[],
  ) {
    this.unsubscribe = signaling.onMessage(this.handleSignalingMessage);
  }

  updateIceServers(iceServers: RTCIceServer[]): void {
    this.iceServers = iceServers;
    for (const state of this.peers.values()) state.pc.setConfiguration({ ...state.pc.getConfiguration(), iceServers });
  }

  private handleSignalingMessage = (message: ServerToClientMessage): void => {
    switch (message.type) {
      case 'peer-joined':
        this.createOfferTo(message.participant.id);
        return;
      case 'signal':
        this.queueSignal(message.fromId, message.data);
        return;
      case 'peer-left':
        this.removePeer(message.participantId);
        return;
    }
  };

  async setLocalMicStream(stream: MediaStream | null): Promise<void> {
    this.localMicTrack = stream?.getAudioTracks()[0] ?? null;
    await Promise.all([...this.peers.values()].map((state) => this.replaceRoleTrack(state, 'microphone', this.localMicTrack)));
  }

  async setScreenTrack(track: MediaStreamTrack | null, audioTrack: MediaStreamTrack | null = null): Promise<void> {
    this.screenTrack = track;
    this.screenAudioTrack = audioTrack;
    if (track) track.contentHint = this.currentQuality?.prioritize === 'clarity' ? 'detail' : 'motion';
    await Promise.all([...this.peers.values()].flatMap((state) => [
      this.replaceRoleTrack(state, 'screenVideo', track).then(() => this.applyEncodingParams(state)),
      this.replaceRoleTrack(state, 'screenAudio', audioTrack).then(() => this.applyAudioEncodingParams(state)),
    ]));
  }

  setScreenQuality(quality: ActiveQuality): void {
    this.currentQuality = quality;
    if (this.screenTrack) this.screenTrack.contentHint = quality.prioritize === 'clarity' ? 'detail' : 'motion';
    for (const state of this.peers.values()) void this.applyEncodingParams(state);
  }

  private mediaKind(role: MediaRole): 'audio' | 'video' {
    return role === 'screenVideo' ? 'video' : 'audio';
  }

  private async replaceRoleTrack(state: PeerState, role: MediaRole, track: MediaStreamTrack | null): Promise<void> {
    if (state.closed) return;
    let sender = state.senders[role];
    if (!sender && !track) return;
    if (!sender) {
      const transceiver = state.pc.addTransceiver(this.mediaKind(role), { direction: 'sendrecv' });
      sender = transceiver.sender;
      state.senders[role] = sender;
    }
    try {
      if (sender.track !== track) await sender.replaceTrack(track);
      if (role === 'screenVideo') await this.applyEncodingParams(state);
      else await this.applyAudioEncodingParams(state);
    } catch (error: unknown) {
      this.reportError(`Could not update ${role} sender for peer ${state.participantId}.`, error);
    }
  }

  private async applyAudioEncodingParams(state: PeerState): Promise<void> {
    for (const [role, sender] of Object.entries(state.senders) as [MediaRole, RTCRtpSender][]) {
      if (role === 'screenVideo' || !sender.track) continue;
      const params = sender.getParameters();
      if (!params.encodings?.length) params.encodings = [{}];
      params.encodings[0].maxBitrate = role === 'screenAudio' ? 128_000 : 64_000;
      try {
        await sender.setParameters(params);
      } catch (error: unknown) {
        this.reportError(`Could not apply ${role} audio encoding parameters.`, error);
      }
    }
  }

  private async applyEncodingParams(state: PeerState): Promise<void> {
    if (!this.currentQuality) return;
    const sender = state.senders.screenVideo;
    if (!sender?.track) return;
    const params = sender.getParameters();
    if (!params.encodings?.length) params.encodings = [{}];
    params.encodings[0].maxBitrate = tierToMaxBitrateKbps(this.currentQuality.resolutionTier) * 1000;
    params.encodings[0].maxFramerate = this.currentQuality.fps;
    params.degradationPreference = this.currentQuality.prioritize === 'clarity' ? 'maintain-resolution' : 'maintain-framerate';
    try {
      await sender.setParameters(params);
    } catch (error: unknown) {
      this.reportError('Could not apply screen encoding parameters.', error);
    }
  }

  startStatsMonitor(onStats: (stats: NetworkStats) => void): void {
    this.stopStatsMonitor();
    this.statsTimer = setInterval(() => {
      void this.collectStats(onStats);
    }, 3_000);
  }

  private async collectStats(onStats: (stats: NetworkStats) => void): Promise<void> {
    let worstLoss = 0;
    let worstRtt = 0;
    let totalBitrateKbps = 0;
    let width: number | undefined;
    let height: number | undefined;
    let fps: number | undefined;
    let transport: NetworkStats['transport'] = 'unknown';
    let sawAny = false;
    for (const state of this.peers.values()) {
      const sender = state.senders.screenVideo;
      if (!sender?.track) continue;
      try {
        const stats = await state.pc.getStats();
        let outboundBytes = 0;
        let outboundTimestamp = 0;
        stats.forEach((report) => {
          const parsed = readRemoteInboundVideoStats(report);
          if (parsed) {
            sawAny = true;
            if (parsed.fractionLost !== undefined) worstLoss = Math.max(worstLoss, parsed.fractionLost);
            if (parsed.roundTripTime !== undefined) worstRtt = Math.max(worstRtt, parsed.roundTripTime * 1000);
          }
          const record = report as RTCStats & Record<string, unknown>;
          if (report.type === 'outbound-rtp' && (record.kind ?? record.mediaType) === 'video') {
            sawAny = true;
            if (typeof record.bytesSent === 'number') outboundBytes += record.bytesSent;
            outboundTimestamp = Math.max(outboundTimestamp, report.timestamp);
            if (typeof record.frameWidth === 'number') width = Math.max(width ?? 0, record.frameWidth);
            if (typeof record.frameHeight === 'number') height = Math.max(height ?? 0, record.frameHeight);
            if (typeof record.framesPerSecond === 'number') fps = fps === undefined ? record.framesPerSecond : Math.min(fps, record.framesPerSecond);
          }
          if (report.type === 'candidate-pair' && record.state === 'succeeded' && (record.nominated === true || record.selected === true)) {
            if (typeof record.currentRoundTripTime === 'number') worstRtt = Math.max(worstRtt, record.currentRoundTripTime * 1000);
            const localCandidate = typeof record.localCandidateId === 'string' ? stats.get(record.localCandidateId) : undefined;
            const remoteCandidate = typeof record.remoteCandidateId === 'string' ? stats.get(record.remoteCandidateId) : undefined;
            const localType = localCandidate ? (localCandidate as RTCStats & Record<string, unknown>).candidateType : undefined;
            const remoteType = remoteCandidate ? (remoteCandidate as RTCStats & Record<string, unknown>).candidateType : undefined;
            const currentTransport = localType === 'relay' || remoteType === 'relay' ? 'relayed' : 'direct';
            if (currentTransport === 'relayed' || transport === 'unknown') transport = currentTransport;
          }
        });
        const previous = this.previousOutboundBytes.get(state.participantId);
        if (previous && outboundTimestamp > previous.timestamp && outboundBytes >= previous.bytes) {
          totalBitrateKbps += ((outboundBytes - previous.bytes) * 8) / (outboundTimestamp - previous.timestamp);
        }
        if (outboundTimestamp > 0) this.previousOutboundBytes.set(state.participantId, { bytes: outboundBytes, timestamp: outboundTimestamp });
      } catch (error: unknown) {
        if (!state.closed) this.reportError(`Could not read WebRTC stats for peer ${state.participantId}.`, error);
      }
    }
    if (sawAny) onStats({ lossPct: worstLoss * 100, rttMs: worstRtt, bitrateKbps: totalBitrateKbps, width, height, fps, transport });
  }

  stopStatsMonitor(): void {
    if (this.statsTimer) clearInterval(this.statsTimer);
    this.statsTimer = null;
    this.previousOutboundBytes.clear();
  }

  private getOrCreatePeerState(participantId: string, initiator = false): PeerState {
    const existing = this.peers.get(participantId);
    if (existing) {
      if (initiator) existing.initiator = true;
      return existing;
    }
    const pc = new RTCPeerConnection({ iceServers: this.iceServers });
    const state: PeerState = {
      participantId,
      pc,
      polite: this.selfId < participantId,
      initiator,
      makingOffer: false,
      ignoreOffer: false,
      isSettingRemoteAnswerPending: false,
      pendingCandidates: new IceCandidateQueue(),
      senders: {},
      remoteStream: new MediaStream(),
      dataChannel: null,
      operationChain: Promise.resolve(),
      reconnect: { attempts: 0, restartInFlight: false, timer: null, disconnectedTimer: null },
      closed: false,
    };
    this.peers.set(participantId, state);
    this.configurePeerState(state);
    if (this.localMicTrack) void this.replaceRoleTrack(state, 'microphone', this.localMicTrack);
    if (this.screenTrack) void this.replaceRoleTrack(state, 'screenVideo', this.screenTrack);
    if (this.screenAudioTrack) void this.replaceRoleTrack(state, 'screenAudio', this.screenAudioTrack);
    return state;
  }

  private configurePeerState(state: PeerState): void {
    const { pc, participantId } = state;
    pc.onicecandidate = (event) => {
      if (!event.candidate) return;
      this.signaling.send({
        type: 'signal',
        targetId: participantId,
        data: {
          kind: 'ice-candidate',
          candidate: {
            candidate: event.candidate.candidate,
            sdpMid: event.candidate.sdpMid,
            sdpMLineIndex: event.candidate.sdpMLineIndex,
            usernameFragment: event.candidate.usernameFragment,
          },
        },
      });
    };

    pc.onnegotiationneeded = () => {
      this.enqueueOperation(state, async () => {
        try {
          state.makingOffer = true;
          await pc.setLocalDescription();
          const description = pc.localDescription;
          if (!description || (description.type !== 'offer' && description.type !== 'answer')) return;
          this.signaling.send({ type: 'signal', targetId: participantId, data: { kind: description.type, sdp: description.sdp } });
        } finally {
          state.makingOffer = false;
        }
      });
    };

    pc.ontrack = (event) => {
      if (!state.remoteStream.getTracks().includes(event.track)) state.remoteStream.addTrack(event.track);
      const publish = () => this.handlers.onRemoteStream({ participantId, stream: state.remoteStream });
      event.track.addEventListener('ended', () => {
        state.remoteStream.removeTrack(event.track);
        publish();
      }, { once: true });
      event.track.addEventListener('mute', publish);
      event.track.addEventListener('unmute', publish);
      publish();
    };

    pc.onconnectionstatechange = () => {
      const connectionState = pc.connectionState;
      this.handlers.onPeerConnectionStateChange?.(participantId, connectionState);
      if (connectionState === 'connected') {
        this.resetReconnectState(state);
      } else if (connectionState === 'disconnected') {
        if (!state.reconnect.disconnectedTimer) {
          state.reconnect.disconnectedTimer = setTimeout(() => {
            state.reconnect.disconnectedTimer = null;
            if (pc.connectionState === 'disconnected') this.scheduleRecovery(state);
          }, DISCONNECTED_GRACE_MS);
        }
        this.handlers.onPeerUnavailable?.(participantId);
      } else if (connectionState === 'failed') {
        this.handlers.onPeerUnavailable?.(participantId);
        this.scheduleRecovery(state);
      }
    };

    pc.ondatachannel = (event) => this.setupDataChannel(state, event.channel);
  }

  private enqueueOperation(state: PeerState, operation: () => Promise<void>): void {
    state.operationChain = state.operationChain
      .then(operation, operation)
      .catch((error: unknown) => this.reportError(`WebRTC operation failed for peer ${state.participantId}.`, error));
  }

  private queueSignal(participantId: string, data: SignalPayload): void {
    const state = this.getOrCreatePeerState(participantId);
    this.enqueueOperation(state, () => this.handleSignal(state, data));
  }

  private async handleSignal(state: PeerState, data: SignalPayload): Promise<void> {
    const { pc } = state;
    if (data.kind === 'ice-candidate') {
      if (state.ignoreOffer) return;
      if (!pc.remoteDescription) {
        state.pendingCandidates.add(data.candidate);
        return;
      }
      await pc.addIceCandidate(data.candidate);
      return;
    }

    const description: RTCSessionDescriptionInit = { type: data.kind, sdp: data.sdp };
    const collision = decideOfferCollision({
      descriptionType: data.kind,
      polite: state.polite,
      makingOffer: state.makingOffer,
      signalingState: pc.signalingState,
      isSettingRemoteAnswerPending: state.isSettingRemoteAnswerPending,
    });
    state.ignoreOffer = collision.ignore;
    if (state.ignoreOffer) {
      state.pendingCandidates.clear();
      return;
    }

    state.isSettingRemoteAnswerPending = description.type === 'answer';
    try {
      await pc.setRemoteDescription(description);
    } finally {
      state.isSettingRemoteAnswerPending = false;
    }
    for (const candidate of state.pendingCandidates.drain()) await pc.addIceCandidate(candidate);

    if (description.type === 'offer') {
      await pc.setLocalDescription();
      const answer = pc.localDescription;
      if (!answer || answer.type !== 'answer') throw new Error('WebRTC did not create an answer.');
      this.signaling.send({ type: 'signal', targetId: state.participantId, data: { kind: 'answer', sdp: answer.sdp } });
    }
  }

  private scheduleRecovery(state: PeerState): void {
    if (state.closed || state.reconnect.restartInFlight || state.reconnect.timer) return;
    if (state.reconnect.attempts >= MAX_RECONNECT_ATTEMPTS) {
      this.reportError(`Connection recovery limit reached for peer ${state.participantId}.`);
      return;
    }
    state.reconnect.attempts += 1;
    const delay = calculateReconnectDelay(state.reconnect.attempts);
    state.reconnect.timer = setTimeout(() => {
      state.reconnect.timer = null;
      if (state.closed || state.pc.connectionState === 'connected') return;
      state.reconnect.restartInFlight = true;
      try {
        state.pc.restartIce();
      } catch (error: unknown) {
        this.reportError(`ICE restart failed for peer ${state.participantId}.`, error);
      } finally {
        state.reconnect.restartInFlight = false;
      }
    }, delay);
  }

  private resetReconnectState(state: PeerState): void {
    state.reconnect.attempts = 0;
    state.reconnect.restartInFlight = false;
    if (state.reconnect.timer) clearTimeout(state.reconnect.timer);
    if (state.reconnect.disconnectedTimer) clearTimeout(state.reconnect.disconnectedTimer);
    state.reconnect.timer = null;
    state.reconnect.disconnectedTimer = null;
  }

  private setupDataChannel(state: PeerState, channel: RTCDataChannel): void {
    if (state.dataChannel && state.dataChannel !== channel && state.dataChannel.readyState !== 'closed') state.dataChannel.close();
    state.dataChannel = channel;
    channel.onmessage = (event) => {
      if (typeof event.data !== 'string') return;
      const data = parseControlMessage(event.data);
      if (!data) {
        this.reportError(`Ignored invalid data-channel message from ${state.participantId}.`);
        return;
      }
      if (data.kind === 'chat') {
        this.handlers.onChatMessage({
          id: data.id,
          participantId: state.participantId,
          nickname: data.nickname,
          text: data.text,
          imageDataUrl: data.imageDataUrl,
          ts: data.ts,
        });
      } else {
        this.handlers.onControlMessage(state.participantId, data);
      }
    };
    channel.onerror = (event) => this.reportError(`Data channel failed for peer ${state.participantId}.`, event);
  }

  createOfferTo(participantId: string): void {
    const state = this.getOrCreatePeerState(participantId, true);
    if (!state.dataChannel || state.dataChannel.readyState === 'closed') {
      this.setupDataChannel(state, state.pc.createDataChannel('control', { ordered: true }));
    }
  }

  broadcast(data: ControlMessage): void {
    const payload = JSON.stringify(data);
    for (const state of this.peers.values()) {
      const channel = state.dataChannel;
      if (!channel || channel.readyState !== 'open') continue;
      if (channel.bufferedAmount + payload.length > MAX_DATA_CHANNEL_BUFFER) {
        this.reportError(`Data channel backpressure limit reached for peer ${state.participantId}.`);
        continue;
      }
      channel.send(payload);
    }
  }

  sendTo(participantId: string, data: ControlMessage): boolean {
    const state = this.peers.get(participantId);
    const channel = state?.dataChannel;
    if (!channel || channel.readyState !== 'open') return false;
    const payload = JSON.stringify(data);
    if (channel.bufferedAmount + payload.length > MAX_DATA_CHANNEL_BUFFER) return false;
    channel.send(payload);
    return true;
  }

  sendChat(nickname: string, text: string, imageDataUrl?: string): ChatMessage {
    const message: ChatMessage = {
      id: crypto.randomUUID(),
      participantId: this.selfId,
      nickname,
      text,
      ...(imageDataUrl ? { imageDataUrl } : {}),
      ts: Date.now(),
    };
    this.broadcast({ kind: 'chat', id: message.id, nickname, text, imageDataUrl, ts: message.ts });
    return message;
  }

  removePeer(participantId: string): void {
    const state = this.peers.get(participantId);
    if (!state) return;
    state.closed = true;
    this.resetReconnectState(state);
    state.pendingCandidates.clear();
    state.dataChannel?.close();
    state.pc.close();
    for (const track of state.remoteStream.getTracks()) track.stop();
    this.peers.delete(participantId);
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.unsubscribe();
    this.stopStatsMonitor();
    for (const participantId of [...this.peers.keys()]) this.removePeer(participantId);
    this.localMicTrack = null;
    this.screenTrack = null;
    this.screenAudioTrack = null;
  }

  private reportError(message: string, error?: unknown): void {
    if (error !== undefined) console.warn(`[webrtc] ${message}`, error);
    else console.warn(`[webrtc] ${message}`);
    this.handlers.onError?.(message, error);
  }
}
