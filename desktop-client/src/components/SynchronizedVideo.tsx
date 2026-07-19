import { useCallback, useEffect, useRef, useState } from 'react';
import { computeMediaId, targetMediaTime, type MediaSyncMessage } from '../lib/mediaSync';

type SyncState = Extract<MediaSyncMessage, { kind: 'media-sync-state' }>;

interface Props {
  isHost: boolean;
  remoteState: SyncState | null;
  clockOffsetMs: number;
  onSendState: (message: SyncState) => void;
}

export function SynchronizedVideo({ isHost, remoteState, clockOffsetMs, onSendState }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const objectUrlRef = useRef<string | null>(null);
  const sequenceRef = useRef(0);
  const mediaIdRef = useRef<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [mediaId, setMediaId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [autoplayBlocked, setAutoplayBlocked] = useState(false);
  const [syncLabel, setSyncLabel] = useState('Choose the same local video file on each device.');

  const emitState = useCallback(() => {
    const video = videoRef.current;
    const currentMediaId = mediaIdRef.current;
    if (!isHost || !video || !currentMediaId || !Number.isFinite(video.duration)) return;
    onSendState({
      kind: 'media-sync-state', mediaId: currentMediaId, sequence: ++sequenceRef.current,
      playing: !video.paused, currentTime: video.currentTime, playbackRate: video.playbackRate, sentAt: Date.now(),
    });
  }, [isHost, onSendState]);

  useEffect(() => {
    if (!isHost) return;
    const timer = window.setInterval(emitState, 2_000);
    return () => window.clearInterval(timer);
  }, [emitState, isHost]);

  useEffect(() => {
    if (isHost || !remoteState) return;
    const video = videoRef.current;
    if (!video || !mediaId) {
      setSyncLabel('Host is ready. Choose your matching local file.');
      return;
    }
    if (mediaId !== remoteState.mediaId) {
      setSyncLabel('This file does not match the host file. Choose the matching copy.');
      return;
    }
    const target = targetMediaTime(remoteState, Date.now(), clockOffsetMs);
    const drift = target - video.currentTime;
    if (Math.abs(drift) > 1.5) video.currentTime = Math.max(0, target);
    if (Math.abs(drift) > 0.12 && Math.abs(drift) <= 1.5 && remoteState.playing) {
      video.playbackRate = Math.max(0.5, Math.min(2, remoteState.playbackRate + Math.sign(drift) * 0.05));
      setSyncLabel(`Correcting ${Math.abs(drift).toFixed(2)} s drift…`);
    } else {
      video.playbackRate = remoteState.playbackRate;
      setSyncLabel('Synchronized with host.');
    }
    if (remoteState.playing && video.paused) {
      video.play().then(() => setAutoplayBlocked(false)).catch(() => setAutoplayBlocked(true));
    } else if (!remoteState.playing && !video.paused) {
      video.pause();
    }
  }, [clockOffsetMs, isHost, mediaId, remoteState]);

  useEffect(() => () => {
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
  }, []);

  async function chooseFile(event: React.ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setLoading(true);
    try {
      const id = await computeMediaId(file);
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
      const objectUrl = URL.createObjectURL(file);
      objectUrlRef.current = objectUrl;
      mediaIdRef.current = id;
      setMediaId(id);
      setFileName(file.name);
      if (videoRef.current) videoRef.current.src = objectUrl;
      setSyncLabel(isHost ? 'Host file selected. Playback controls are authoritative.' : 'File selected. Waiting for host state…');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="sync-video-stage">
      <video
        ref={videoRef}
        controls={isHost}
        playsInline
        onLoadedMetadata={emitState}
        onPlay={emitState}
        onPause={emitState}
        onSeeked={emitState}
        onRateChange={emitState}
      />
      {!mediaId && <div className="sync-video-placeholder">No local video selected.</div>}
      <div className="sync-video-controls" data-control-input-blocked>
        <label className="file-button">
          {loading ? 'Reading file…' : isHost ? 'Choose host video' : 'Choose matching video'}
          <input type="file" accept="video/*" onChange={(event) => void chooseFile(event)} disabled={loading} />
        </label>
        {fileName && <span title={fileName}>{fileName}</span>}
        <span className="sync-status">{syncLabel}</span>
        {autoplayBlocked && <button className="primary" onClick={() => videoRef.current?.play().then(() => setAutoplayBlocked(false))}>Enable playback</button>}
      </div>
    </div>
  );
}
