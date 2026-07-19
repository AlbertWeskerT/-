import { useEffect, useRef, useState } from 'react';

interface Props {
  stream: MediaStream | null;
}

/**
 * Plays back audio-only remote streams. Used specifically for the HOST:
 * their main <video> shows their own screen (no audio track in it at all),
 * so without this, incoming mic audio from participants has nowhere to
 * actually play — it arrives over the connection but is never rendered.
 * (Guests don't need this separately: their main video element already
 * plays the host's combined screen+mic stream together.)
 */
export function RemoteAudioSink({ stream }: Props) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [needsPlayClick, setNeedsPlayClick] = useState(false);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.srcObject = stream;
    const startPlayback = () => {
      audio.play().then(() => setNeedsPlayClick(false)).catch(() => setNeedsPlayClick(true));
    };
    if (stream) startPlayback();
    // A peer can add their mic after the connection already exists. The
    // MediaStream object stays the same, so React does not rerun this effect;
    // retry playback when that new audio track arrives.
    stream?.addEventListener('addtrack', startPlayback);
    return () => stream?.removeEventListener('addtrack', startPlayback);
  }, [stream]);

  if (!stream) return null;

  return (
    <>
      <audio ref={audioRef} autoPlay />
      {needsPlayClick && (
        <button className="enable-sound-inline" onClick={() => audioRef.current?.play().then(() => setNeedsPlayClick(false))}>
          🔇 Click to hear participants
        </button>
      )}
    </>
  );
}
