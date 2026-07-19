import packageInfo from '../../package.json';
import type { SignalingStatus } from '../lib/signalingClient';
import type { NetworkStats } from '../lib/peerManager';

interface Props {
  signalingUrl: string;
  signalingStatus: SignalingStatus;
  reconnectAttempts: number;
  roomId: string;
  peerStates: Record<string, RTCPeerConnectionState>;
  networkStats: NetworkStats | null;
  turnConfigured: boolean;
}

export function DiagnosticsPanel({ signalingUrl, signalingStatus, reconnectAttempts, roomId, peerStates, networkStats, turnConfigured }: Props) {
  return (
    <details className="panel diagnostics-panel">
      <summary>Diagnostics</summary>
      <dl>
        <dt>Version</dt><dd>{packageInfo.version}</dd>
        <dt>Signaling</dt><dd>{signalingStatus}{reconnectAttempts ? ` (${reconnectAttempts})` : ''}</dd>
        <dt>Endpoint</dt><dd title={signalingUrl}>{signalingUrl}</dd>
        <dt>Room</dt><dd>{roomId.slice(0, 8)}</dd>
        <dt>Peers</dt><dd>{Object.values(peerStates).join(', ') || 'waiting'}</dd>
        <dt>Transport</dt><dd>{networkStats?.transport ?? 'unknown'}</dd>
        <dt>TURN</dt><dd>{turnConfigured ? 'configured' : 'unavailable'}</dd>
        <dt>RTT / loss</dt><dd>{networkStats ? `${Math.round(networkStats.rttMs)} ms / ${networkStats.lossPct.toFixed(1)}%` : 'not measured'}</dd>
        <dt>Video</dt><dd>{networkStats?.width && networkStats.height ? `${networkStats.width}×${networkStats.height} · ${networkStats.fps?.toFixed(0) ?? '?'} fps` : 'not measured'}</dd>
        <dt>Bitrate</dt><dd>{networkStats?.bitrateKbps ? `${Math.round(networkStats.bitrateKbps)} kbps` : 'not measured'}</dd>
      </dl>
    </details>
  );
}
