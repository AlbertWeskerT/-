export type StageMode = 'screen' | 'video';

export type MediaSyncMessage =
  | { kind: 'stage-mode'; mode: StageMode }
  | { kind: 'media-sync-state'; mediaId: string; sequence: number; playing: boolean; currentTime: number; playbackRate: number; sentAt: number }
  | { kind: 'media-sync-probe'; probeId: string; clientSentAt: number }
  | { kind: 'media-sync-probe-response'; probeId: string; clientSentAt: number; hostSentAt: number };

const ID_PATTERN = /^[0-9a-f]{64}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function parseMediaSyncMessage(value: Record<string, unknown>): MediaSyncMessage | null {
  if (value.kind === 'stage-mode' && (value.mode === 'screen' || value.mode === 'video')) return { kind: 'stage-mode', mode: value.mode };
  if (value.kind === 'media-sync-state') {
    if (
      typeof value.mediaId !== 'string' || !ID_PATTERN.test(value.mediaId)
      || !Number.isInteger(value.sequence) || Number(value.sequence) < 1
      || typeof value.playing !== 'boolean'
      || typeof value.currentTime !== 'number' || !Number.isFinite(value.currentTime) || value.currentTime < 0
      || typeof value.playbackRate !== 'number' || !Number.isFinite(value.playbackRate) || value.playbackRate < 0.5 || value.playbackRate > 2
      || typeof value.sentAt !== 'number' || !Number.isFinite(value.sentAt)
    ) return null;
    return {
      kind: 'media-sync-state', mediaId: value.mediaId, sequence: Number(value.sequence), playing: value.playing,
      currentTime: value.currentTime, playbackRate: value.playbackRate, sentAt: value.sentAt,
    };
  }
  if (value.kind === 'media-sync-probe') {
    if (typeof value.probeId !== 'string' || !UUID_PATTERN.test(value.probeId) || typeof value.clientSentAt !== 'number' || !Number.isFinite(value.clientSentAt)) return null;
    return { kind: 'media-sync-probe', probeId: value.probeId, clientSentAt: value.clientSentAt };
  }
  if (value.kind === 'media-sync-probe-response') {
    if (
      typeof value.probeId !== 'string' || !UUID_PATTERN.test(value.probeId)
      || typeof value.clientSentAt !== 'number' || !Number.isFinite(value.clientSentAt)
      || typeof value.hostSentAt !== 'number' || !Number.isFinite(value.hostSentAt)
    ) return null;
    return { kind: 'media-sync-probe-response', probeId: value.probeId, clientSentAt: value.clientSentAt, hostSentAt: value.hostSentAt };
  }
  return null;
}

export async function computeMediaId(file: File): Promise<string> {
  const chunkSize = Math.min(1024 * 1024, file.size);
  const first = new Uint8Array(await file.slice(0, chunkSize).arrayBuffer());
  const lastStart = Math.max(0, file.size - chunkSize);
  const last = new Uint8Array(await file.slice(lastStart).arrayBuffer());
  const sizeBytes = new TextEncoder().encode(String(file.size));
  const combined = new Uint8Array(first.length + last.length + sizeBytes.length);
  combined.set(first, 0);
  combined.set(last, first.length);
  combined.set(sizeBytes, first.length + last.length);
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', combined));
  return [...hash].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function targetMediaTime(
  state: Extract<MediaSyncMessage, { kind: 'media-sync-state' }>,
  localNow: number,
  clockOffsetMs: number,
): number {
  if (!state.playing) return state.currentTime;
  return state.currentTime + Math.max(0, (localNow + clockOffsetMs - state.sentAt) / 1000) * state.playbackRate;
}
