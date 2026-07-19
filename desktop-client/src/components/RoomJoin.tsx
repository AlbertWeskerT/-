import { useState } from 'react';
import type { SignalingStatus } from '../lib/signalingClient';

const NICKNAME_STORAGE_KEY = 'watch-together.nickname.v1';

function loadRememberedNickname(): string {
  try {
    return localStorage.getItem(NICKNAME_STORAGE_KEY)?.slice(0, 20) ?? '';
  } catch {
    return '';
  }
}

function rememberNickname(nickname: string): void {
  try {
    localStorage.setItem(NICKNAME_STORAGE_KEY, nickname);
  } catch (error: unknown) {
    console.warn('[ui] Could not remember the nickname.', error);
  }
}

interface Props {
  onCreateRoom: (nickname: string) => void;
  onJoinRoom: (code: string, nickname: string) => void;
  onJoinInvitation: (nickname: string) => void;
  invitationRoomId?: string;
  error?: string | null;
  busy?: boolean;
  connectionStatus?: SignalingStatus;
  onRetryConnection: () => void;
  onReturnHome: () => void;
  showDeveloperSettings: boolean;
  onResetNetworkSettings: () => void;
}

export function RoomJoin({
  onCreateRoom,
  onJoinRoom,
  onJoinInvitation,
  invitationRoomId,
  error,
  busy,
  connectionStatus,
  onRetryConnection,
  onReturnHome,
  showDeveloperSettings,
  onResetNetworkSettings,
}: Props) {
  const [mode, setMode] = useState<'host' | 'join'>(invitationRoomId ? 'join' : 'host');
  const [nickname, setNickname] = useState(loadRememberedNickname);
  const [code, setCode] = useState('');

  const canSubmit = nickname.trim().length > 0 && (mode === 'host' || Boolean(invitationRoomId) || code.trim().length === 6);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    rememberNickname(nickname.trim());
    if (mode === 'host') onCreateRoom(nickname.trim());
    else if (invitationRoomId) onJoinInvitation(nickname.trim());
    else onJoinRoom(code.trim().toUpperCase(), nickname.trim());
  }

  return (
    <div className="app-shell">
      <form className="join-card" onSubmit={handleSubmit}>
        <div className="eyebrow">P2P room · voice · screen sharing</div>
        <h1>Watch Together</h1>

        {!invitationRoomId && <div className="tab-toggle">
          <button type="button" className={mode === 'host' ? 'active' : ''} onClick={() => setMode('host')}>
            Host a room
          </button>
          <button type="button" className={mode === 'join' ? 'active' : ''} onClick={() => setMode('join')}>
            Join a room
          </button>
        </div>}

        {invitationRoomId && (
          <div className="invite-room-notice">
            <span>Direct room invitation</span>
            <button type="button" onClick={onReturnHome}>Back to home</button>
          </div>
        )}

        {connectionStatus === 'waking' && (
          <div className="wake-banner">Сервер запускается после простоя. Это может занять до минуты.</div>
        )}
        {error && <div className="error-banner">{error}</div>}
        {error && !busy && <button type="button" onClick={onRetryConnection}>Retry connection</button>}

        <div className="field">
          <label htmlFor="nickname">Your nickname</label>
          <input
            id="nickname"
            value={nickname}
            onChange={(e) => setNickname(e.target.value)}
            placeholder="e.g. Kirito"
            maxLength={20}
            autoFocus
          />
        </div>

        {mode === 'join' && !invitationRoomId && (
          <div className="field">
            <label htmlFor="code">Room code</label>
            <input
              id="code"
              className="code-input"
              value={code}
              onChange={(e) => setCode(e.target.value.trim().toUpperCase().slice(0, 6))}
              placeholder="XXXXXX"
              maxLength={12}
            />
          </div>
        )}

        <button type="submit" className="primary" disabled={!canSubmit || busy} style={{ width: '100%', padding: '10px' }}>
          {busy ? connectionStatus === 'waking' ? 'Waking server…' : 'Connecting…' : mode === 'host' ? 'Create room' : 'Join room'}
        </button>

        {showDeveloperSettings && (
          <details className="developer-settings">
            <summary>Developer Settings</summary>
            <p className="hint-text">The production service address is built into the app and has priority over saved development values.</p>
            <button type="button" onClick={onResetNetworkSettings}>Reset network settings</button>
          </details>
        )}
      </form>
    </div>
  );
}
