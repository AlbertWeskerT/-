import type { Participant } from '../../../shared/types';
import type { ControlCapabilities, ControlSessionDescriptor, DesktopMonitorTarget } from '../lib/controlState';

export interface PendingControlRequest {
  participantId: string;
  requestId: string;
  capabilities: ControlCapabilities;
}

export interface ActiveHostControl {
  participantId: string;
  nickname: string;
  session: ControlSessionDescriptor;
  startedAt: number;
}

interface Props {
  isHost: boolean;
  canRequest: boolean;
  desktopAvailable: boolean;
  participants: Participant[];
  pendingRequests: PendingControlRequest[];
  activeHostControl: ActiveHostControl | null;
  guestStatus: 'idle' | 'pending' | 'active' | 'revoked' | 'unavailable';
  guestSession: ControlSessionDescriptor | null;
  now: number;
  monitors: DesktopMonitorTarget[];
  selectedMonitorId: string;
  onMonitorChange: (monitorId: string) => void;
  onRequest: (keyboard: boolean) => void;
  onApprove: (request: PendingControlRequest, keyboard: boolean) => void;
  onDeny: (request: PendingControlRequest) => void;
  onStop: () => void;
}

function durationLabel(milliseconds: number): string {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

export function ControlPanel(props: Props) {
  const { isHost, canRequest, desktopAvailable, participants, pendingRequests, activeHostControl, guestStatus, guestSession, now, monitors, selectedMonitorId, onMonitorChange, onRequest, onApprove, onDeny, onStop } = props;
  return (
    <div className={`panel control-panel ${activeHostControl || guestStatus === 'active' ? 'control-panel-active' : ''}`} data-control-input-blocked>
      <h3>Remote control</h3>
      {isHost ? (
        <>
          {!desktopAvailable && <div className="hint-text">Input execution is available only in the Windows desktop host.</div>}
          {desktopAvailable && !activeHostControl && (
            <label className="control-monitor-select">Controlled monitor
              <select value={selectedMonitorId} onChange={(event) => onMonitorChange(event.target.value)}>
                {monitors.map((monitor) => <option key={monitor.id} value={monitor.id}>{monitor.label} · {monitor.width}×{monitor.height}</option>)}
              </select>
            </label>
          )}
          {activeHostControl && (
            <div className="active-control-card">
              <strong>{activeHostControl.nickname}</strong>
              <span>{activeHostControl.session.capabilities.keyboard ? 'Mouse + keyboard' : 'Mouse only'}</span>
              <span>Active {durationLabel(now - activeHostControl.startedAt)}</span>
              <button className="danger" onClick={onStop}>Stop control</button>
              <div className="hint-text">Emergency stop: Ctrl + Shift + F12</div>
            </div>
          )}
          {!activeHostControl && pendingRequests.length === 0 && <div className="hint-text">No pending requests.</div>}
          {!activeHostControl && pendingRequests.map((request) => {
            const nickname = participants.find((participant) => participant.id === request.participantId)?.nickname ?? 'Guest';
            return (
              <div className="control-request-card" key={request.requestId}>
                <strong>{nickname} requests control</strong>
                <div className="control-request-actions">
                  <button className="primary" disabled={!desktopAvailable || !selectedMonitorId} onClick={() => onApprove(request, false)}>Allow mouse</button>
                  <button disabled={!desktopAvailable || !selectedMonitorId} onClick={() => onApprove(request, true)}>Mouse + keyboard</button>
                  <button className="danger" onClick={() => onDeny(request)}>Deny</button>
                </div>
              </div>
            );
          })}
        </>
      ) : (
        <>
          {guestStatus === 'idle' && (
            <div className="control-request-actions">
              <button disabled={!canRequest} onClick={() => onRequest(false)}>Request mouse</button>
              <button disabled={!canRequest} onClick={() => onRequest(true)}>Request mouse + keyboard</button>
            </div>
          )}
          {guestStatus === 'pending' && <div className="media-status warning">Waiting for host approval…</div>}
          {guestStatus === 'active' && guestSession && (
            <div className="active-control-card">
              <strong>Control active</strong>
              <span>{guestSession.capabilities.keyboard ? 'Mouse + keyboard' : 'Mouse only'}</span>
              <span>Expires in {durationLabel(guestSession.expiresAt - now)}</span>
              <button className="danger" onClick={onStop}>Stop control</button>
            </div>
          )}
          {guestStatus === 'revoked' && <div className="hint-text">Control ended. Request it again if needed.</div>}
          {guestStatus === 'unavailable' && <div className="hint-text">The active room preset does not allow remote control.</div>}
        </>
      )}
    </div>
  );
}
