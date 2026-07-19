import type { Participant } from '../../../shared/types';

interface Props {
  participants: Participant[];
  selfId: string;
  connectionStates?: Record<string, RTCPeerConnectionState>;
  speakingParticipants?: Record<string, boolean>;
}

function statusClass(state: RTCPeerConnectionState | undefined): string {
  if (state === 'connected') return 'status-dot status-good';
  if (state === 'connecting' || state === 'new') return 'status-dot status-connecting';
  if (state === 'failed' || state === 'disconnected' || state === 'closed') return 'status-dot status-bad';
  return 'status-dot';
}

function statusLabel(state: RTCPeerConnectionState | undefined): string {
  switch (state) {
    case 'connected': return 'connected';
    case 'connecting': return 'connecting…';
    case 'new': return 'connecting…';
    case 'disconnected': return 'connection unstable';
    case 'failed': return 'connection failed';
    case 'closed': return 'disconnected';
    default: return '';
  }
}

export function ParticipantList({ participants, selfId, connectionStates, speakingParticipants }: Props) {
  return (
    <div className="panel">
      <h3>In this room ({participants.length})</h3>
      {participants.map((p) => {
        const state = p.id === selfId ? undefined : connectionStates?.[p.id];
        return (
          <div className={`participant-row ${speakingParticipants?.[p.id] ? 'participant-speaking' : ''}`} key={p.id} title={statusLabel(state)}>
            <span className={p.id === selfId ? 'status-dot status-good' : statusClass(state)} />
            <span>{p.nickname}{p.id === selfId ? ' (you)' : ''}</span>
            {speakingParticipants?.[p.id] && <span className="speaking-label">speaking</span>}
            <span className="role-badge">{p.roleId}</span>
          </div>
        );
      })}
    </div>
  );
}
