import { useEffect, useRef, useState } from 'react';
import { DrawingCanvas } from './DrawingCanvas';
import type { DrawingMessage, DrawingStroke, NormalizedPoint } from '../lib/drawingState';
import { RemoteControlSurface } from './RemoteControlSurface';
import type { ControlInputEvent } from '../lib/controlState';

interface Props {
  stream: MediaStream | null;
  isHost: boolean;
  isSharing: boolean;
  controllingNickname?: string | null;
  drawingEnabled: boolean;
  drawingStrokes: DrawingStroke[];
  drawingCursors: Record<string, NormalizedPoint & { nickname: string; visible: boolean }>;
  canClearAllDrawing: boolean;
  onDrawingEnabledChange: (enabled: boolean) => void;
  onDrawingMessage: (message: DrawingMessage) => void;
  onClearDrawing: (scope: 'mine' | 'all') => void;
  remoteControlActive: boolean;
  remoteKeyboardEnabled: boolean;
  onRemoteControlEvent: (event: ControlInputEvent) => void;
}

export function ScreenStage({ stream, isHost, isSharing, controllingNickname, drawingEnabled, drawingStrokes, drawingCursors, canClearAllDrawing, onDrawingEnabledChange, onDrawingMessage, onClearDrawing, remoteControlActive, remoteKeyboardEnabled, onRemoteControlEvent }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [needsPlayClick, setNeedsPlayClick] = useState(false);
  const [hasPlayableVideo, setHasPlayableVideo] = useState(false);
  const [mediaAspectRatio, setMediaAspectRatio] = useState<number | null>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.srcObject = stream;
    const refreshVideoState = () => {
      const liveTracks = stream?.getVideoTracks().filter((track) => track.readyState === 'live') ?? [];
      setHasPlayableVideo(liveTracks.some((track) => !track.muted));
    };
    const startPlayback = () => {
      // Some browsers block autoplay-with-sound until there's been a user
      // gesture on the page. We already require a click to join/create a
      // room, which usually satisfies that — but if it doesn't, surface a
      // clear "click to enable sound" prompt instead of silently having no
      // audio with no explanation.
      video.play().then(() => setNeedsPlayClick(false)).catch(() => setNeedsPlayClick(true));
    };
    const refreshAspectRatio = () => {
      if (video.videoWidth > 0 && video.videoHeight > 0) setMediaAspectRatio(video.videoWidth / video.videoHeight);
    };
    if (stream) startPlayback();
    refreshVideoState();
    // Mic audio can arrive later through renegotiation while the screen track
    // is already playing. Retrying here makes that late audio audible too.
    stream?.addEventListener('addtrack', startPlayback);
    stream?.addEventListener('addtrack', refreshVideoState);
    stream?.addEventListener('removetrack', refreshVideoState);
    video.addEventListener('loadedmetadata', refreshAspectRatio);
    video.addEventListener('resize', refreshAspectRatio);
    const tracks = stream?.getVideoTracks() ?? [];
    for (const track of tracks) {
      track.addEventListener('mute', refreshVideoState);
      track.addEventListener('unmute', refreshVideoState);
      track.addEventListener('ended', refreshVideoState);
    }
    return () => {
      stream?.removeEventListener('addtrack', startPlayback);
      stream?.removeEventListener('addtrack', refreshVideoState);
      stream?.removeEventListener('removetrack', refreshVideoState);
      video.removeEventListener('loadedmetadata', refreshAspectRatio);
      video.removeEventListener('resize', refreshAspectRatio);
      for (const track of tracks) {
        track.removeEventListener('mute', refreshVideoState);
        track.removeEventListener('unmute', refreshVideoState);
        track.removeEventListener('ended', refreshVideoState);
      }
    };
  }, [stream]);

  useEffect(() => {
    const onChange = () => setIsFullscreen(document.fullscreenElement === stageRef.current);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  function toggleFullscreen() {
    if (!stageRef.current) return;
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      stageRef.current.requestFullscreen().catch(() => {
        // Fullscreen just isn't available in this context (e.g. an embedded iframe).
      });
    }
  }

  function handleEnableSound() {
    videoRef.current?.play().then(() => setNeedsPlayClick(false));
  }

  return (
    <div className="stage" ref={stageRef}>
      {stream && <video ref={videoRef} autoPlay playsInline muted={isHost} className={hasPlayableVideo ? '' : 'audio-only-video'} />}
      {!hasPlayableVideo && (
        <div className="placeholder placeholder-overlay">
          {isHost
            ? isSharing
              ? 'Waiting for your screen share to start…'
              : 'Click "Share screen" to start streaming to the room.'
            : 'Waiting for the host to share their screen…'}
        </div>
      )}
      {needsPlayClick && !isHost && (
        <button className="enable-sound-btn" onClick={handleEnableSound}>
          🔇 Click to enable sound
        </button>
      )}
      {stream && !remoteControlActive && (
        <DrawingCanvas
          enabled={drawingEnabled}
          canClearAll={canClearAllDrawing}
          mediaAspectRatio={mediaAspectRatio}
          strokes={drawingStrokes}
          cursors={drawingCursors}
          onEnabledChange={onDrawingEnabledChange}
          onMessage={onDrawingMessage}
          onClear={onClearDrawing}
        />
      )}
      {hasPlayableVideo && (
        <RemoteControlSurface
          active={remoteControlActive}
          keyboardEnabled={remoteKeyboardEnabled}
          mediaAspectRatio={mediaAspectRatio}
          onEvent={onRemoteControlEvent}
        />
      )}
      {controllingNickname && (
        <div className="control-indicator">{controllingNickname} is controlling this screen</div>
      )}
      {hasPlayableVideo && (
        <button className="fullscreen-btn" onClick={toggleFullscreen} title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}>
          {isFullscreen ? '⤢ Exit fullscreen' : '⛶ Fullscreen'}
        </button>
      )}
    </div>
  );
}
