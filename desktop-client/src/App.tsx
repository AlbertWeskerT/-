import { useCallback, useEffect, useRef, useState } from 'react';
import { SignalingClient, type SignalingStatus } from './lib/signalingClient';
import { PeerManager, type ChatMessage, type NetworkStats } from './lib/peerManager';
import type { Room, ActiveQuality } from '../../shared/types';
import { BUILTIN_PRESETS, DEFAULT_ACTIVE_QUALITY, tierToTargetLongSide } from '../../shared/types';
import { RoomJoin } from './components/RoomJoin';
import { RoomHeader } from './components/RoomHeader';
import { ParticipantList } from './components/ParticipantList';
import { ChatPanel } from './components/ChatPanel';
import { PresetSelector } from './components/PresetSelector';
import { QualitySelector } from './components/QualitySelector';
import { ScreenStage } from './components/ScreenStage';
import { RemoteAudioSink } from './components/RemoteAudioSink';
import { MicrophoneControls, type MicrophonePermissionState } from './components/MicrophoneControls';
import { AudioLevelMonitor } from './lib/audioLevel';
import { DesktopSetup } from './components/DesktopSetup';
import { clearStoredRuntimeConfig, hasEmbeddedRuntimeConfig, loadRuntimeConfig, type RuntimeConfig } from './lib/runtimeConfig';
import { buildRoomInvitationUrl, parseRoomInvitation, type RoomInvitation } from './lib/roomLink';
import { applyDrawingSegment, clearDrawingStrokes, type DrawingMessage, type DrawingStroke, type NormalizedPoint } from './lib/drawingState';
import { ControlPanel, type ActiveHostControl, type PendingControlRequest } from './components/ControlPanel';
import { createControlNonce, type ControlInputEvent, type ControlSessionDescriptor, type ControlSessionMessage, type DesktopMonitorTarget } from './lib/controlState';
import { applyDesktopControlEvent, heartbeatDesktopControl, isTauriDesktop, listDesktopMonitors, onDesktopEmergencyStop, startDesktopControlSession, stopDesktopControlSession } from './lib/desktopControl';
import { SynchronizedVideo } from './components/SynchronizedVideo';
import type { MediaSyncMessage, StageMode } from './lib/mediaSync';
import { DiagnosticsPanel } from './components/DiagnosticsPanel';
import type { IceServerConfig } from '../../shared/protocol';

function describeMicrophoneError(error: unknown): string {
  if (error instanceof DOMException) {
    if (error.name === 'NotAllowedError') return 'Microphone access was blocked. Allow it in the browser site permissions, then try again.';
    if (error.name === 'NotFoundError') return 'No microphone was found. Connect or enable a microphone, then try again.';
    if (error.name === 'NotReadableError') return 'The microphone is busy in another app. Close that app and try again.';
  }
  return 'Could not start the microphone. Check your browser permissions and selected input device.';
}

function buildScreenConstraints(quality: ActiveQuality): MediaTrackConstraints {
  const longSide = tierToTargetLongSide(quality.resolutionTier);
  // Both width and height are given as the same "ideal" long-side hint rather
  // than a fixed WxH pair, so the browser fits to it without forcing 16:9 —
  // the source's own aspect ratio is preserved.
  return {
    width: { ideal: longSide },
    height: { ideal: longSide },
    frameRate: { ideal: quality.fps, max: quality.fps },
  };
}

// Ordered low → high. "Auto" mode steps along this ladder based on measured
// packet loss / round-trip time, instead of the host picking a fixed combo.
const QUALITY_LADDER: { resolutionTier: ActiveQuality['resolutionTier']; fps: ActiveQuality['fps'] }[] = [
  { resolutionTier: 360, fps: 15 },
  { resolutionTier: 480, fps: 15 },
  { resolutionTier: 480, fps: 30 },
  { resolutionTier: 720, fps: 30 },
  { resolutionTier: 1080, fps: 30 },
  { resolutionTier: 1080, fps: 60 },
  { resolutionTier: 1440, fps: 60 },
];

type PendingRoomAction =
  | { type: 'create'; nickname: string }
  | { type: 'join-code'; code: string; nickname: string }
  | { type: 'join-invite'; roomId: string; inviteToken: string; nickname: string };

export default function App() {
  const initialInvitationRef = useRef<RoomInvitation | null>(parseRoomInvitation(window.location));
  const [runtimeConfig, setRuntimeConfig] = useState<RuntimeConfig | null>(() => loadRuntimeConfig());
  const [screen, setScreen] = useState<'join' | 'call'>('join');
  const [error, setError] = useState<string | null>(() => (
    window.location.pathname.startsWith('/room/') && !initialInvitationRef.current
      ? 'This invitation link is invalid. Return to the home page and enter a room code.'
      : null
  ));
  const [busy, setBusy] = useState(false);

  const [room, setRoom] = useState<Room | null>(null);
  const [roomInvitation, setRoomInvitation] = useState<RoomInvitation | null>(initialInvitationRef.current);
  const [selfId, setSelfId] = useState('');
  const [nickname, setNickname] = useState('');

  // Keep each participant's stream separately. A single `remoteStream`
  // caused the last guest to overwrite every earlier guest's audio.
  const [remoteStreams, setRemoteStreams] = useState<Record<string, MediaStream>>({});
  const [isSharing, setIsSharing] = useState(false);
  const [micOn, setMicOn] = useState(false);
  const [microphones, setMicrophones] = useState<MediaDeviceInfo[]>([]);
  const [selectedMicrophoneId, setSelectedMicrophoneId] = useState('');
  const [microphonePermission, setMicrophonePermission] = useState<MicrophonePermissionState>('unknown');
  const [microphoneLevel, setMicrophoneLevel] = useState(0);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [speakingParticipants, setSpeakingParticipants] = useState<Record<string, boolean>>({});
  const [localScreenStream, setLocalScreenStream] = useState<MediaStream | null>(null);
  const [systemAudioIncluded, setSystemAudioIncluded] = useState<boolean | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [connectionStates, setConnectionStates] = useState<Record<string, RTCPeerConnectionState>>({});
  const [networkStats, setNetworkStats] = useState<NetworkStats | null>(null);
  const [signalingStatus, setSignalingStatus] = useState<SignalingStatus>('idle');
  const [signalingReconnectAttempts, setSignalingReconnectAttempts] = useState(0);
  const [drawingEnabled, setDrawingEnabled] = useState(false);
  const [drawingStrokes, setDrawingStrokes] = useState<DrawingStroke[]>([]);
  const [drawingCursors, setDrawingCursors] = useState<Record<string, NormalizedPoint & { nickname: string; visible: boolean }>>({});
  const [pendingControlRequests, setPendingControlRequests] = useState<PendingControlRequest[]>([]);
  const [activeHostControl, setActiveHostControl] = useState<ActiveHostControl | null>(null);
  const [guestControlSession, setGuestControlSession] = useState<ControlSessionDescriptor | null>(null);
  const [guestControlStatus, setGuestControlStatus] = useState<'idle' | 'pending' | 'active' | 'revoked'>('idle');
  const [controlClock, setControlClock] = useState(Date.now());
  const [stageMode, setStageMode] = useState<StageMode>('screen');
  const [remoteMediaSyncState, setRemoteMediaSyncState] = useState<Extract<MediaSyncMessage, { kind: 'media-sync-state' }> | null>(null);
  const [mediaClockOffsetMs, setMediaClockOffsetMs] = useState(0);
  const [desktopMonitors, setDesktopMonitors] = useState<DesktopMonitorTarget[]>([]);
  const [selectedMonitorId, setSelectedMonitorId] = useState('');
  const [iceServers, setIceServers] = useState<IceServerConfig[]>([]);

  const signalingRef = useRef<SignalingClient | null>(null);
  const pendingRoomActionRef = useRef<PendingRoomAction | null>(null);
  const roomResponseTimerRef = useRef<number | null>(null);
  const peerManagerRef = useRef<PeerManager | null>(null);
  const roomRef = useRef<Room | null>(null);
  const selfIdRef = useRef('');
  const screenTrackRef = useRef<MediaStreamTrack | null>(null);
  const screenAudioTrackRef = useRef<MediaStreamTrack | null>(null);
  const screenStreamRef = useRef<MediaStream | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const microphoneMonitorRef = useRef<AudioLevelMonitor | null>(null);
  // Refs so the stats-polling callback (started once per share session)
  // always reads current values instead of a stale closure from whenever
  // sharing began.
  const activeQualityRef = useRef<ActiveQuality>(DEFAULT_ACTIVE_QUALITY);
  const ladderIndexRef = useRef(0);
  const goodStreakRef = useRef(0);
  const badStreakRef = useRef(0);
  const activeHostControlRef = useRef<ActiveHostControl | null>(null);
  const guestControlSessionRef = useRef<ControlSessionDescriptor | null>(null);
  const guestControlRequestIdRef = useRef<string | null>(null);
  const guestControlSequenceRef = useRef(0);

  const isHost = !!room && room.hostId === selfId;
  const activeQuality: ActiveQuality = room?.activeQuality ?? DEFAULT_ACTIVE_QUALITY;
  const activePreset = BUILTIN_PRESETS.find((preset) => preset.id === (room?.activePresetId ?? 'watch-together')) ?? BUILTIN_PRESETS[0];
  const hostVideoAvailable = Boolean(room && remoteStreams[room.hostId]?.getVideoTracks().some((track) => track.readyState === 'live'));
  const canRequestControl = !isHost && activePreset.canUseMouse && signalingStatus === 'connected' && stageMode === 'screen' && hostVideoAvailable;
  roomRef.current = room;
  selfIdRef.current = selfId;
  activeQualityRef.current = activeQuality;
  activeHostControlRef.current = activeHostControl;
  guestControlSessionRef.current = guestControlSession;

  const teardown = useCallback(() => {
    if (roomResponseTimerRef.current) clearTimeout(roomResponseTimerRef.current);
    roomResponseTimerRef.current = null;
    peerManagerRef.current?.destroy();
    peerManagerRef.current = null;
    signalingRef.current?.close();
    signalingRef.current = null;
    screenStreamRef.current?.getTracks().forEach((track) => track.stop());
    screenStreamRef.current = null;
    screenTrackRef.current = null;
    screenAudioTrackRef.current = null;
    micStreamRef.current?.getTracks().forEach((t) => t.stop());
    micStreamRef.current = null;
    microphoneMonitorRef.current?.stop();
    microphoneMonitorRef.current = null;
    activeHostControlRef.current = null;
    guestControlSessionRef.current = null;
    void stopDesktopControlSession();
  }, []);

  useEffect(() => () => teardown(), [teardown]);

  useEffect(() => {
    if (!activeHostControl && !guestControlSession) return;
    const timer = window.setInterval(() => setControlClock(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [activeHostControl, guestControlSession]);

  useEffect(() => {
    if (!guestControlSession) return;
    const timer = window.setInterval(() => {
      const session = guestControlSessionRef.current;
      if (!session) return;
      if (Date.now() >= session.expiresAt) {
        void stopAnyControl('expired');
        return;
      }
      const sequence = ++guestControlSequenceRef.current;
      peerManagerRef.current?.sendTo(roomRef.current?.hostId ?? '', {
        kind: 'control-heartbeat', sessionId: session.sessionId, nonce: session.nonce, sequence,
      });
    }, 2_000);
    return () => window.clearInterval(timer);
  }, [guestControlSession]);

  useEffect(() => {
    const hostControl = activeHostControlRef.current;
    const guestControl = guestControlSessionRef.current;
    const incompatible = !activePreset.canUseMouse
      || Boolean((hostControl?.session.capabilities.keyboard || guestControl?.capabilities.keyboard) && !activePreset.canUseKeyboard);
    if ((hostControl || guestControl) && incompatible) void stopAnyControl('host-stopped');
  }, [activePreset.canUseKeyboard, activePreset.canUseMouse]);

  useEffect(() => {
    let unlisten: (() => void) | null = null;
    void onDesktopEmergencyStop(() => void stopAnyControl('emergency-stop')).then((cleanup) => { unlisten = cleanup; });
    return () => unlisten?.();
  }, []);

  useEffect(() => {
    if (!isTauriDesktop()) return;
    void listDesktopMonitors().then((monitors) => {
      setDesktopMonitors(monitors);
      setSelectedMonitorId((current) => monitors.some((monitor) => monitor.id === current) ? current : (monitors[0]?.id ?? ''));
    }).catch((monitorError: unknown) => console.warn('[control] Could not enumerate monitors.', monitorError));
  }, []);

  const refreshMicrophones = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) {
      setMicrophonePermission('unavailable');
      return;
    }
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      setMicrophones(devices.filter((device) => device.kind === 'audioinput'));
    } catch (error: unknown) {
      console.warn('[media] Could not enumerate microphones.', error);
    }
  }, []);

  useEffect(() => {
    void refreshMicrophones();
    const onDeviceChange = () => void refreshMicrophones();
    navigator.mediaDevices?.addEventListener('devicechange', onDeviceChange);
    return () => navigator.mediaDevices?.removeEventListener('devicechange', onDeviceChange);
  }, [refreshMicrophones]);

  useEffect(() => {
    if (!navigator.permissions?.query) return;
    let permission: PermissionStatus | null = null;
    const updatePermission = () => setMicrophonePermission(permission?.state ?? 'unknown');
    navigator.permissions.query({ name: 'microphone' as PermissionName }).then((status) => {
      permission = status;
      updatePermission();
      status.addEventListener('change', updatePermission);
    }).catch((error: unknown) => {
      console.warn('[media] Microphone permission query is unavailable in this browser.', error);
    });
    return () => permission?.removeEventListener('change', updatePermission);
  }, []);

  function wireSignaling(sc: SignalingClient) {
    sc.onStatus((status, attempt) => {
      setSignalingStatus(status);
      setSignalingReconnectAttempts(attempt);
      if (status !== 'connected' && status !== 'connecting' && (activeHostControlRef.current || guestControlSessionRef.current)) {
        void stopAnyControl('disconnect');
      }
    });
    sc.onMessage((msg) => {
      switch (msg.type) {
        case 'room-created':
        case 'room-joined': {
          if (roomResponseTimerRef.current) clearTimeout(roomResponseTimerRef.current);
          roomResponseTimerRef.current = null;
          pendingRoomActionRef.current = null;
          setRoom(msg.room);
          setSelfId(msg.selfId);
          selfIdRef.current = msg.selfId;
          if (msg.type === 'room-created') {
            setRoomInvitation({ roomId: msg.room.id, inviteToken: msg.inviteToken });
          }
          setIceServers(msg.iceServers);
          peerManagerRef.current = new PeerManager(sc, msg.selfId, {
            onRemoteStream: (e) => setRemoteStreams((previous) => ({ ...previous, [e.participantId]: e.stream })),
            onChatMessage: (m) => {
              const trustedNickname = roomRef.current?.participants.find((participant) => participant.id === m.participantId)?.nickname ?? 'Participant';
              const trustedMessage = { ...m, nickname: trustedNickname };
              setMessages((previous) => previous.some((message) => message.id === trustedMessage.id) ? previous : [...previous, trustedMessage]);
            },
            onControlMessage: (participantId, data) => {
              if (data.kind === 'voice-activity') {
                setSpeakingParticipants((previous) => ({ ...previous, [participantId]: data.speaking }));
              } else if (data.kind === 'drawing-segment') {
                setDrawingStrokes((previous) => applyDrawingSegment(previous, participantId, data));
              } else if (data.kind === 'drawing-clear') {
                if (data.scope === 'all' && participantId !== roomRef.current?.hostId) return;
                setDrawingStrokes((previous) => clearDrawingStrokes(previous, participantId, data.scope));
              } else if (data.kind === 'drawing-cursor') {
                const cursorNickname = roomRef.current?.participants.find((participant) => participant.id === participantId)?.nickname ?? 'Participant';
                setDrawingCursors((previous) => ({ ...previous, [participantId]: { x: data.x, y: data.y, visible: data.visible, nickname: cursorNickname } }));
              } else if (
                data.kind === 'control-request'
                || data.kind === 'control-response'
                || data.kind === 'control-event'
                || data.kind === 'control-heartbeat'
                || data.kind === 'control-revoked'
              ) {
                void handleControlMessage(participantId, data);
              } else if (data.kind === 'stage-mode') {
                if (participantId === roomRef.current?.hostId) setStageMode(data.mode);
              } else if (data.kind === 'media-sync-state') {
                if (participantId === roomRef.current?.hostId) setRemoteMediaSyncState((previous) => !previous || data.sequence > previous.sequence ? data : previous);
              } else if (data.kind === 'media-sync-probe') {
                if (roomRef.current?.hostId === selfIdRef.current) {
                  peerManagerRef.current?.sendTo(participantId, { kind: 'media-sync-probe-response', probeId: data.probeId, clientSentAt: data.clientSentAt, hostSentAt: Date.now() });
                }
              } else if (data.kind === 'media-sync-probe-response') {
                if (participantId === roomRef.current?.hostId) setMediaClockOffsetMs(data.hostSentAt - ((data.clientSentAt + Date.now()) / 2));
              }
            },
            onPeerConnectionStateChange: (participantId, state) =>
              setConnectionStates((prev) => ({ ...prev, [participantId]: state })),
            onPeerUnavailable: () => setError('A peer connection was interrupted. Recovery is in progress.'),
            onError: (message) => setError(message),
          }, msg.iceServers);
          setScreen('call');
          setBusy(false);
          break;
        }
        case 'session-resumed':
          setRoom(msg.room);
          setSelfId(msg.selfId);
          selfIdRef.current = msg.selfId;
          setError(null);
          setScreen('call');
          setIceServers(msg.iceServers);
          peerManagerRef.current?.updateIceServers(msg.iceServers);
          break;
        case 'ice-servers':
          setIceServers(msg.iceServers);
          peerManagerRef.current?.updateIceServers(msg.iceServers);
          break;
        case 'room-updated':
          setRoom(msg.room);
          break;
        case 'peer-joined':
          setRoom((r) => (r ? { ...r, participants: [...r.participants, msg.participant] } : r));
          break;
        case 'peer-left':
          if (activeHostControlRef.current?.participantId === msg.participantId) void stopAnyControl('disconnect');
          setRoom((r) => (r ? { ...r, participants: r.participants.filter((p) => p.id !== msg.participantId) } : r));
          setRemoteStreams((previous) => {
            const remaining = { ...previous };
            delete remaining[msg.participantId];
            return remaining;
          });
          setSpeakingParticipants((previous) => {
            const remaining = { ...previous };
            delete remaining[msg.participantId];
            return remaining;
          });
          break;
        case 'participant-connection':
          if (!msg.connected && activeHostControlRef.current?.participantId === msg.participantId) void stopAnyControl('disconnect');
          setConnectionStates((previous) => ({
            ...previous,
            [msg.participantId]: msg.connected ? 'connecting' : 'disconnected',
          }));
          break;
        case 'chat-message':
          setMessages((previous) => previous.some((candidate) => candidate.id === msg.message.id)
            ? previous
            : [...previous, msg.message].sort((left, right) => left.ts - right.ts));
          break;
        case 'chat-history':
          setMessages((previous) => {
            const byId = new Map(previous.map((message) => [message.id, message]));
            for (const message of msg.messages) byId.set(message.id, message);
            return [...byId.values()].sort((left, right) => left.ts - right.ts).slice(-100);
          });
          break;
        case 'room-closed':
          void stopAnyControl('disconnect');
          teardown();
          setRoom(null);
          setSelfId('');
          setRemoteStreams({});
          setIsSharing(false);
          setMicOn(false);
          setMicrophoneLevel(0);
          setIsSpeaking(false);
          setSpeakingParticipants({});
          setLocalScreenStream(null);
          setSystemAudioIncluded(null);
          setMessages([]);
          setConnectionStates({});
          setNetworkStats(null);
          setDrawingEnabled(false);
          setDrawingStrokes([]);
          setDrawingCursors({});
          setPendingControlRequests([]);
          setActiveHostControl(null);
          setGuestControlSession(null);
          setGuestControlStatus('idle');
          setStageMode('screen');
          setRemoteMediaSyncState(null);
          setMediaClockOffsetMs(0);
          setIceServers([]);
          setError(`Room closed: ${msg.reason.replaceAll('-', ' ')}.`);
          setScreen('join');
          break;
        case 'error':
          if (roomResponseTimerRef.current) clearTimeout(roomResponseTimerRef.current);
          roomResponseTimerRef.current = null;
          setError(msg.message);
          setBusy(false);
          break;
      }
    });
  }

  async function connectAndSend(build: (sc: SignalingClient) => void) {
    setBusy(true);
    setError(null);
    setSignalingStatus('idle');
    setSignalingReconnectAttempts(0);
    try {
      if (!runtimeConfig) throw new Error('Desktop runtime configuration is missing.');
      signalingRef.current?.close();
      const sc = new SignalingClient(runtimeConfig.signalingUrl);
      signalingRef.current = sc;
      wireSignaling(sc);
      await sc.connect();
      build(sc);
      roomResponseTimerRef.current = window.setTimeout(() => {
        if (signalingRef.current !== sc) return;
        sc.close();
        signalingRef.current = null;
        setSignalingStatus('failed');
        setError('The signaling server connected but did not answer the room request within 12 seconds. Retry the connection.');
        setBusy(false);
      }, 12_000);
    } catch (connectionError: unknown) {
      console.warn('[signaling] Initial connection failed.', connectionError);
      const detail = connectionError instanceof Error ? connectionError.message : 'Unknown connection error.';
      signalingRef.current?.close();
      signalingRef.current = null;
      setSignalingStatus('failed');
      setError(`Could not reach ${runtimeConfig?.signalingUrl ?? 'the configured signaling server'}. ${detail}`);
      setBusy(false);
    }
  }

  function runRoomAction(action: PendingRoomAction): void {
    if (action.type === 'create') {
      void connectAndSend((sc) => sc.send({ type: 'create-room', nickname: action.nickname }));
    } else if (action.type === 'join-code') {
      void connectAndSend((sc) => sc.send({ type: 'join-room', code: action.code, nickname: action.nickname }));
    } else {
      void connectAndSend((sc) => sc.send({
        type: 'join-room',
        roomId: action.roomId,
        inviteToken: action.inviteToken,
        nickname: action.nickname,
      }));
    }
  }

  function handleCreateRoom(nick: string) {
    setNickname(nick);
    const action: PendingRoomAction = { type: 'create', nickname: nick };
    pendingRoomActionRef.current = action;
    runRoomAction(action);
  }

  function handleJoinRoom(code: string, nick: string) {
    setNickname(nick);
    const action: PendingRoomAction = { type: 'join-code', code: code.trim().toUpperCase(), nickname: nick };
    pendingRoomActionRef.current = action;
    runRoomAction(action);
  }

  function handleJoinInvitation(nick: string) {
    if (!roomInvitation) return;
    setNickname(nick);
    const action: PendingRoomAction = {
      type: 'join-invite',
      roomId: roomInvitation.roomId,
      inviteToken: roomInvitation.inviteToken,
      nickname: nick,
    };
    pendingRoomActionRef.current = action;
    runRoomAction(action);
  }

  function handleRetryConnection(): void {
    const action = pendingRoomActionRef.current;
    if (!action) {
      setError('Enter your nickname and room details, then try again.');
      return;
    }
    runRoomAction(action);
  }

  function handleReturnHome(): void {
    window.history.replaceState({}, '', '/');
    setRoomInvitation(null);
    pendingRoomActionRef.current = null;
    setError(null);
    setBusy(false);
  }

  function handleResetNetworkSettings(): void {
    clearStoredRuntimeConfig();
    const embedded = hasEmbeddedRuntimeConfig();
    setRuntimeConfig(loadRuntimeConfig());
    setError(embedded
      ? 'Saved development network settings were reset. The built-in production service remains active.'
      : 'Saved network settings were reset.');
  }

  function handleLeave() {
    signalingRef.current?.send({ type: 'leave-room' });
    teardown();
    setRoom(null);
    setSelfId('');
    setRemoteStreams({});
    setIsSharing(false);
    setMicOn(false);
    setMicrophoneLevel(0);
    setIsSpeaking(false);
    setSpeakingParticipants({});
    setLocalScreenStream(null);
    setSystemAudioIncluded(null);
    setMessages([]);
    setConnectionStates({});
    setNetworkStats(null);
    setDrawingEnabled(false);
    setDrawingStrokes([]);
    setDrawingCursors({});
    setPendingControlRequests([]);
    setActiveHostControl(null);
    setGuestControlSession(null);
    setGuestControlStatus('idle');
    setStageMode('screen');
    setRemoteMediaSyncState(null);
    setMediaClockOffsetMs(0);
    setIceServers([]);
    setError(null);
    setScreen('join');
  }

  async function startMicrophone(deviceId = selectedMicrophoneId): Promise<void> {
    const previousStream = micStreamRef.current;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
        },
      });
      const microphoneTrack = stream.getAudioTracks()[0];
      if (!microphoneTrack || microphoneTrack.readyState !== 'live') {
        stream.getTracks().forEach((track) => track.stop());
        throw new DOMException('No live microphone track was returned.', 'NotReadableError');
      }

      micStreamRef.current = stream;
      await peerManagerRef.current?.setLocalMicStream(stream);
      previousStream?.getTracks().forEach((track) => track.stop());
      const actualDeviceId = microphoneTrack.getSettings().deviceId;
      if (actualDeviceId) setSelectedMicrophoneId(actualDeviceId);
      microphoneMonitorRef.current?.stop();
      const monitor = new AudioLevelMonitor();
      microphoneMonitorRef.current = monitor;
      monitor.start(stream, (level, speaking, changed) => {
        setMicrophoneLevel(level);
        setIsSpeaking(speaking && microphoneTrack.enabled);
        if (changed) peerManagerRef.current?.broadcast({ kind: 'voice-activity', speaking: speaking && microphoneTrack.enabled });
      });

      microphoneTrack.addEventListener('ended', () => {
        if (micStreamRef.current !== stream) return;
        void peerManagerRef.current?.setLocalMicStream(null);
        micStreamRef.current = null;
        microphoneMonitorRef.current?.stop();
        microphoneMonitorRef.current = null;
        setMicrophoneLevel(0);
        setIsSpeaking(false);
        peerManagerRef.current?.broadcast({ kind: 'voice-activity', speaking: false });
        setMicOn(false);
        setError('Microphone was disconnected or stopped. Click Unmute to choose it again.');
      }, { once: true });
      setMicrophonePermission('granted');
      setMicOn(true);
      setError(null);
      await refreshMicrophones();
    } catch (error: unknown) {
      if (error instanceof DOMException && error.name === 'NotAllowedError') setMicrophonePermission('denied');
      setError(describeMicrophoneError(error));
    }
  }

  async function toggleMic(): Promise<void> {
    const microphoneTrack = micStreamRef.current?.getAudioTracks()[0];
    if (!microphoneTrack || microphoneTrack.readyState !== 'live') {
      await startMicrophone();
      return;
    }
    const nextEnabled = !microphoneTrack.enabled;
    microphoneTrack.enabled = nextEnabled;
    microphoneMonitorRef.current?.resetActivity();
    setMicOn(nextEnabled);
    if (!nextEnabled) {
      setMicrophoneLevel(0);
      setIsSpeaking(false);
    }
    peerManagerRef.current?.broadcast({ kind: 'voice-activity', speaking: nextEnabled ? isSpeaking : false });
  }

  function handleMicrophoneDeviceChange(deviceId: string): void {
    setSelectedMicrophoneId(deviceId);
    const activeTrack = micStreamRef.current?.getAudioTracks()[0];
    if (activeTrack?.readyState === 'live') void startMicrophone(deviceId);
  }

  async function finishScreenShare(stream: MediaStream, stopTracks: boolean): Promise<void> {
    if (screenStreamRef.current !== stream) return;
    screenStreamRef.current = null;
    screenTrackRef.current = null;
    screenAudioTrackRef.current = null;
    await peerManagerRef.current?.setScreenTrack(null);
    peerManagerRef.current?.stopStatsMonitor();
    if (stopTracks) stream.getTracks().forEach((track) => track.stop());
    setLocalScreenStream(null);
    setNetworkStats(null);
    setSystemAudioIncluded(null);
    setIsSharing(false);
  }

  async function toggleScreenShare() {
    if (!isSharing) {
      try {
        const stream = await navigator.mediaDevices.getDisplayMedia({
          video: buildScreenConstraints(activeQuality),
          // When the browser/OS supports it, this captures the sound of the
          // shared tab/window as well. The user still chooses whether to
          // include it in the native browser picker.
          audio: {
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false,
          },
        });
        const track = stream.getVideoTracks()[0];
        if (!track || track.readyState !== 'live') {
          stream.getTracks().forEach((candidate) => candidate.stop());
          throw new DOMException('No live screen track was returned.', 'NotReadableError');
        }
        const audioTrack = stream.getAudioTracks()[0] ?? null;
        screenStreamRef.current = stream;
        screenTrackRef.current = track;
        screenAudioTrackRef.current = audioTrack;
        audioTrack?.addEventListener('ended', () => {
          if (screenStreamRef.current !== stream) return;
          screenAudioTrackRef.current = null;
          void peerManagerRef.current?.setScreenTrack(screenTrackRef.current, null);
          setSystemAudioIncluded(false);
        }, { once: true });
        track.addEventListener('ended', () => void finishScreenShare(stream, true), { once: true });
        // Set quality first so contentHint/bitrate ceiling are ready the
        // moment the track is actually attached to each connection.
        peerManagerRef.current?.setScreenQuality(activeQuality);
        await peerManagerRef.current?.setScreenTrack(track, audioTrack);
        setLocalScreenStream(stream);
        setSystemAudioIncluded(Boolean(audioTrack));
        setIsSharing(true);
        setError(null);

        ladderIndexRef.current = closestLadderIndex(activeQuality);
        goodStreakRef.current = 0;
        badStreakRef.current = 0;
        peerManagerRef.current?.startStatsMonitor(handleNetworkStats);
      } catch (error: unknown) {
        console.warn('[media] Could not start screen sharing.', error);
        setError(error instanceof DOMException && error.name === 'NotAllowedError'
          ? 'Screen share permission was denied or cancelled.'
          : 'Screen sharing could not start. Choose another source and try again.');
      }
    } else {
      const stream = screenStreamRef.current;
      if (stream) await finishScreenShare(stream, true);
    }
  }

  function closestLadderIndex(quality: ActiveQuality): number {
    let best = 0;
    let bestDist = Infinity;
    QUALITY_LADDER.forEach((step, i) => {
      const dist = Math.abs(step.resolutionTier - quality.resolutionTier) + Math.abs(step.fps - quality.fps);
      if (dist < bestDist) {
        bestDist = dist;
        best = i;
      }
    });
    return best;
  }

  function handleNetworkStats(stats: NetworkStats) {
    setNetworkStats(stats);

    const quality = activeQualityRef.current;
    if (quality.mode !== 'auto' || !isHost) return;

    const fractionLost = stats.lossPct / 100;
    const rttMs = stats.rttMs;
    const bad = fractionLost > 0.03 || rttMs > 300;
    const good = fractionLost < 0.01 && rttMs < 150;

    if (bad) {
      badStreakRef.current += 1;
      goodStreakRef.current = 0;
      if (badStreakRef.current >= 2 && ladderIndexRef.current > 0) {
        ladderIndexRef.current -= 1;
        badStreakRef.current = 0;
        applyLadderStep(quality);
      }
    } else if (good) {
      goodStreakRef.current += 1;
      badStreakRef.current = 0;
      if (goodStreakRef.current >= 5 && ladderIndexRef.current < QUALITY_LADDER.length - 1) {
        ladderIndexRef.current += 1;
        goodStreakRef.current = 0;
        applyLadderStep(quality);
      }
    } else {
      goodStreakRef.current = 0;
      badStreakRef.current = 0;
    }
  }

  function applyLadderStep(current: ActiveQuality) {
    const step = QUALITY_LADDER[ladderIndexRef.current];
    handleQualityChange({ resolutionTier: step.resolutionTier, fps: step.fps, prioritize: current.prioritize, mode: 'auto' });
  }

  function handleQualityChange(quality: ActiveQuality) {
    signalingRef.current?.send({ type: 'set-active-quality', quality });
    peerManagerRef.current?.setScreenQuality(quality);
    if (screenTrackRef.current) {
      screenTrackRef.current.applyConstraints(buildScreenConstraints(quality)).catch((error: unknown) => {
        console.warn('[media] Could not apply capture constraints.', error);
        setError('The selected capture quality could not be applied to the current source. Restart screen sharing or choose another quality.');
      });
    }
  }

  function handlePresetChange(presetId: string) {
    signalingRef.current?.send({ type: 'set-active-preset', presetId });
  }

  function handleSendChat(text: string, imageDataUrl?: string) {
    signalingRef.current?.send({ type: 'chat-message', id: crypto.randomUUID(), text, imageDataUrl });
  }

  function handleDrawingMessage(message: DrawingMessage): void {
    if (message.kind === 'drawing-segment') {
      setDrawingStrokes((previous) => applyDrawingSegment(previous, selfId, message));
    } else if (message.kind === 'drawing-cursor') {
      setDrawingCursors((previous) => ({ ...previous, [selfId]: { x: message.x, y: message.y, visible: message.visible, nickname } }));
    }
    peerManagerRef.current?.broadcast(message);
  }

  function handleClearDrawing(scope: 'mine' | 'all'): void {
    if (scope === 'all' && !isHost) return;
    setDrawingStrokes((previous) => clearDrawingStrokes(previous, selfId, scope));
    peerManagerRef.current?.broadcast({ kind: 'drawing-clear', scope });
  }

  async function handleControlMessage(participantId: string, message: ControlSessionMessage): Promise<void> {
    const currentRoom = roomRef.current;
    if (!currentRoom) return;
    if (message.kind === 'control-request') {
      if (currentRoom.hostId !== selfIdRef.current || !currentRoom.participants.some((participant) => participant.id === participantId)) return;
      const preset = BUILTIN_PRESETS.find((candidate) => candidate.id === (currentRoom.activePresetId ?? 'watch-together')) ?? BUILTIN_PRESETS[0];
      if (!preset.canUseMouse || !screenTrackRef.current) {
        peerManagerRef.current?.sendTo(participantId, { kind: 'control-response', requestId: message.requestId, approved: false, reason: 'Remote control is not available for the current room state.' });
        return;
      }
      if (activeHostControlRef.current) {
        peerManagerRef.current?.sendTo(participantId, { kind: 'control-response', requestId: message.requestId, approved: false, reason: 'Another control session is active.' });
        return;
      }
      setPendingControlRequests((previous) => previous.some((request) => request.participantId === participantId)
        ? previous.map((request) => request.participantId === participantId ? { participantId, requestId: message.requestId, capabilities: message.capabilities } : request)
        : [...previous, { participantId, requestId: message.requestId, capabilities: message.capabilities }]);
      return;
    }
    if (message.kind === 'control-response') {
      if (participantId !== currentRoom.hostId || message.requestId !== guestControlRequestIdRef.current) return;
      guestControlRequestIdRef.current = null;
      if (!message.approved) {
        setGuestControlStatus('revoked');
        return;
      }
      guestControlSequenceRef.current = 0;
      guestControlSessionRef.current = message.session;
      setGuestControlSession(message.session);
      setGuestControlStatus('active');
      setDrawingEnabled(false);
      return;
    }
    if (message.kind === 'control-event' || message.kind === 'control-heartbeat') {
      const active = activeHostControlRef.current;
      if (!active || participantId !== active.participantId || message.sessionId !== active.session.sessionId || message.nonce !== active.session.nonce) return;
      if (Date.now() >= active.session.expiresAt) {
        await stopAnyControl('expired');
        return;
      }
      try {
        if (message.kind === 'control-event') await applyDesktopControlEvent(active.session, message.sequence, message.event);
        else await heartbeatDesktopControl(active.session, message.sequence);
      } catch (nativeError: unknown) {
        console.warn('[control] Native input command failed.', nativeError);
        setError('Remote control stopped because the desktop input command failed.');
        await stopAnyControl('host-stopped');
      }
      return;
    }
    if (message.kind === 'control-revoked') {
      const active = activeHostControlRef.current;
      if (active && active.participantId === participantId && active.session.sessionId === message.sessionId) {
        await stopAnyControl(message.reason, false);
      } else if (participantId === currentRoom.hostId && guestControlSessionRef.current?.sessionId === message.sessionId) {
        guestControlSessionRef.current = null;
        setGuestControlSession(null);
        setGuestControlStatus('revoked');
      }
    }
  }

  function requestControl(keyboard: boolean): void {
    if (!canRequestControl || !room) return;
    const requestId = crypto.randomUUID();
    guestControlRequestIdRef.current = requestId;
    const sent = peerManagerRef.current?.sendTo(room.hostId, {
      kind: 'control-request', requestId, capabilities: { mouse: true, keyboard }, requestedAt: Date.now(),
    });
    if (sent) setGuestControlStatus('pending');
    else setError('The host control channel is not connected yet. Try again in a moment.');
  }

  async function approveControl(request: PendingControlRequest, keyboard: boolean): Promise<void> {
    if (!roomRef.current || activeHostControlRef.current || !isTauriDesktop()) return;
    const participant = roomRef.current.participants.find((candidate) => candidate.id === request.participantId);
    if (!participant) return;
    const targetMonitor = desktopMonitors.find((monitor) => monitor.id === selectedMonitorId);
    if (!targetMonitor || !screenTrackRef.current) {
      setError('Choose the monitor that is currently shared before allowing control.');
      return;
    }
    const displaySurface = screenTrackRef.current.getSettings().displaySurface;
    if (displaySurface === 'window' || displaySurface === 'browser') {
      setError('Window or tab sharing cannot be mapped safely. Share the full selected monitor to enable control.');
      return;
    }
    const allowKeyboard = keyboard && activePreset.canUseKeyboard && request.capabilities.keyboard;
    const session: ControlSessionDescriptor = {
      sessionId: crypto.randomUUID(),
      nonce: createControlNonce(),
      expiresAt: Date.now() + Math.min(activePreset.autoRevokeMs ?? 5 * 60_000, 15 * 60_000),
      capabilities: { mouse: true, keyboard: allowKeyboard },
    };
    try {
      await startDesktopControlSession(session, targetMonitor);
      const active: ActiveHostControl = { participantId: participant.id, nickname: participant.nickname, session, startedAt: Date.now() };
      activeHostControlRef.current = active;
      setActiveHostControl(active);
      setPendingControlRequests([]);
      setDrawingEnabled(false);
      peerManagerRef.current?.sendTo(participant.id, { kind: 'control-response', requestId: request.requestId, approved: true, session });
    } catch (nativeError: unknown) {
      console.warn('[control] Could not start native control session.', nativeError);
      setError('The desktop host could not start remote control.');
      peerManagerRef.current?.sendTo(participant.id, { kind: 'control-response', requestId: request.requestId, approved: false, reason: 'Desktop control could not start.' });
    }
  }

  function denyControl(request: PendingControlRequest): void {
    setPendingControlRequests((previous) => previous.filter((candidate) => candidate.requestId !== request.requestId));
    peerManagerRef.current?.sendTo(request.participantId, { kind: 'control-response', requestId: request.requestId, approved: false, reason: 'The host declined the request.' });
  }

  async function stopAnyControl(reason: Extract<ControlSessionMessage, { kind: 'control-revoked' }>['reason'], notify = true): Promise<void> {
    const hostControl = activeHostControlRef.current;
    if (hostControl) {
      activeHostControlRef.current = null;
      setActiveHostControl(null);
      await stopDesktopControlSession(hostControl.session.sessionId).catch((nativeError: unknown) => console.warn('[control] Failed to stop native session.', nativeError));
      if (notify) peerManagerRef.current?.sendTo(hostControl.participantId, { kind: 'control-revoked', sessionId: hostControl.session.sessionId, reason });
    }
    const guestSession = guestControlSessionRef.current;
    if (guestSession) {
      guestControlSessionRef.current = null;
      setGuestControlSession(null);
      setGuestControlStatus('revoked');
      if (notify) peerManagerRef.current?.sendTo(roomRef.current?.hostId ?? '', { kind: 'control-revoked', sessionId: guestSession.sessionId, reason });
    } else if (guestControlRequestIdRef.current) {
      guestControlRequestIdRef.current = null;
      setGuestControlStatus('idle');
    }
  }

  const handleRemoteControlEvent = useCallback((controlEvent: ControlInputEvent): void => {
    const session = guestControlSessionRef.current;
    const hostId = roomRef.current?.hostId;
    if (!session || !hostId) return;
    if (Date.now() >= session.expiresAt) {
      void stopAnyControl('expired');
      return;
    }
    const sequence = ++guestControlSequenceRef.current;
    peerManagerRef.current?.sendTo(hostId, {
      kind: 'control-event', sessionId: session.sessionId, nonce: session.nonce, sequence, event: controlEvent,
    });
  }, []);

  function handleStageModeChange(mode: StageMode): void {
    if (!isHost) return;
    setStageMode(mode);
    peerManagerRef.current?.broadcast({ kind: 'stage-mode', mode });
  }

  const handleMediaSyncState = useCallback((message: Extract<MediaSyncMessage, { kind: 'media-sync-state' }>): void => {
    peerManagerRef.current?.broadcast(message);
  }, []);

  useEffect(() => {
    if (isHost || stageMode !== 'video' || !room) return;
    const clientSentAt = Date.now();
    peerManagerRef.current?.sendTo(room.hostId, { kind: 'media-sync-probe', probeId: crypto.randomUUID(), clientSentAt });
  }, [isHost, room, stageMode]);

  if (!runtimeConfig) return <DesktopSetup onConfigured={setRuntimeConfig} />;

  if (screen === 'join' || !room) {
    return (
      <RoomJoin
        key={roomInvitation ? 'invitation' : 'home'}
        onCreateRoom={handleCreateRoom}
        onJoinRoom={handleJoinRoom}
        onJoinInvitation={handleJoinInvitation}
        invitationRoomId={roomInvitation?.roomId}
        error={error}
        busy={busy}
        connectionStatus={signalingStatus}
        onRetryConnection={handleRetryConnection}
        onReturnHome={handleReturnHome}
        showDeveloperSettings={isTauriDesktop()}
        onResetNetworkSettings={handleResetNetworkSettings}
      />
    );
  }

  return (
    <div className="call-room">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minHeight: 0 }}>
        <RoomHeader
          code={room.code}
          nickname={nickname}
          invitationUrl={isHost && roomInvitation ? buildRoomInvitationUrl(runtimeConfig.publicAppUrl, roomInvitation) : undefined}
          signalingStatus={signalingStatus}
          reconnectAttempts={signalingReconnectAttempts}
          onLeave={handleLeave}
        />
        {isHost && (
          <div className="stage-mode-toggle">
            <button className={stageMode === 'screen' ? 'primary' : ''} onClick={() => handleStageModeChange('screen')}>Screen share</button>
            <button className={stageMode === 'video' ? 'primary' : ''} onClick={() => handleStageModeChange('video')}>Synchronized video</button>
          </div>
        )}
        {stageMode === 'screen' ? <ScreenStage
          stream={isHost ? localScreenStream : (remoteStreams[room.hostId] ?? null)}
          isHost={isHost}
          isSharing={isSharing}
          drawingEnabled={drawingEnabled}
          drawingStrokes={drawingStrokes}
          drawingCursors={drawingCursors}
          canClearAllDrawing={isHost}
          onDrawingEnabledChange={setDrawingEnabled}
          onDrawingMessage={handleDrawingMessage}
          onClearDrawing={handleClearDrawing}
          controllingNickname={activeHostControl?.nickname ?? null}
          remoteControlActive={!isHost && guestControlStatus === 'active'}
          remoteKeyboardEnabled={Boolean(guestControlSession?.capabilities.keyboard)}
          onRemoteControlEvent={handleRemoteControlEvent}
        /> : (
          <SynchronizedVideo
            isHost={isHost}
            remoteState={remoteMediaSyncState}
            clockOffsetMs={mediaClockOffsetMs}
            onSendState={handleMediaSyncState}
          />
        )}
        <div className="toolbar">
          <MicrophoneControls
            devices={microphones}
            selectedDeviceId={selectedMicrophoneId}
            micOn={micOn}
            level={microphoneLevel}
            speaking={isSpeaking}
            permission={microphonePermission}
            onToggle={() => void toggleMic()}
            onDeviceChange={handleMicrophoneDeviceChange}
          />
          {isHost && (
            <button className={isSharing ? 'danger' : 'primary'} onClick={() => void toggleScreenShare()}>
              {isSharing ? 'Stop sharing' : 'Share screen'}
            </button>
          )}
          {isHost && isSharing && (
            <span className={`media-status ${systemAudioIncluded ? 'available' : 'warning'}`}>
              {systemAudioIncluded ? 'System audio included' : 'System audio not provided by this source'}
            </span>
          )}
        </div>
        {Object.entries(remoteStreams).filter(([participantId]) => isHost || stageMode === 'video' || participantId !== room.hostId).map(([participantId, stream]) => (
          <RemoteAudioSink key={participantId} stream={stream} />
        ))}
        {error && <div className="error-banner">{error}</div>}
      </div>

      <div className="sidebar">
        <ParticipantList
          participants={room.participants}
          selfId={selfId}
          connectionStates={connectionStates}
          speakingParticipants={{ ...speakingParticipants, [selfId]: isSpeaking }}
        />
        <ControlPanel
          isHost={isHost}
          canRequest={canRequestControl}
          desktopAvailable={isTauriDesktop()}
          participants={room.participants}
          pendingRequests={pendingControlRequests}
          activeHostControl={activeHostControl}
          guestStatus={isHost ? 'idle' : guestControlStatus === 'idle' && !canRequestControl ? 'unavailable' : guestControlStatus}
          guestSession={guestControlSession}
          now={controlClock}
          monitors={desktopMonitors}
          selectedMonitorId={selectedMonitorId}
          onMonitorChange={setSelectedMonitorId}
          onRequest={requestControl}
          onApprove={(request, keyboard) => void approveControl(request, keyboard)}
          onDeny={denyControl}
          onStop={() => void stopAnyControl(isHost ? 'host-stopped' : 'guest-stopped')}
        />
        <PresetSelector isHost={isHost} activePresetId={room.activePresetId} onChange={handlePresetChange} />
        <QualitySelector isHost={isHost} quality={activeQuality} onChange={handleQualityChange} networkStats={networkStats} isSharing={isSharing} />
        <DiagnosticsPanel
          signalingUrl={runtimeConfig.signalingUrl}
          signalingStatus={signalingStatus}
          reconnectAttempts={signalingReconnectAttempts}
          roomId={room.id}
          peerStates={connectionStates}
          networkStats={networkStats}
          turnConfigured={iceServers.some((server) => server.urls.some((url) => url.startsWith('turn:') || url.startsWith('turns:')))}
        />
        <ChatPanel messages={messages} selfNickname={nickname} onSend={handleSendChat} />
      </div>
    </div>
  );
}
