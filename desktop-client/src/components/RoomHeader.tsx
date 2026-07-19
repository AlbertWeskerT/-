import { useState } from 'react';
import type { SignalingStatus } from '../lib/signalingClient';

interface Props {
  code: string;
  nickname: string;
  invitationUrl?: string;
  signalingStatus: SignalingStatus;
  reconnectAttempts: number;
  onLeave: () => void;
}

export function RoomHeader({ code, nickname, invitationUrl, signalingStatus, reconnectAttempts, onLeave }: Props) {
  const [copied, setCopied] = useState<'code' | 'link' | null>(null);

  async function copyCode(): Promise<void> {
    await navigator.clipboard.writeText(code);
    setCopied('code');
    window.setTimeout(() => setCopied(null), 1800);
  }

  async function copyInvitation(): Promise<void> {
    if (!invitationUrl) return;
    await navigator.clipboard.writeText(invitationUrl);
    setCopied('link');
    window.setTimeout(() => setCopied(null), 1800);
  }

  return (
    <div className="panel" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
      <div style={{ flex: 1 }}>
        <div className="hint-text" style={{ marginTop: 0 }}>Room code</div>
        <div className="room-code-value" style={{ fontFamily: 'var(--font-mono)', letterSpacing: '0.2em', fontSize: 18, color: 'var(--accent)' }}>
          {code}
        </div>
        <button onClick={() => void copyCode()}>{copied === 'code' ? 'Copied' : 'Copy code'}</button>
      </div>
      {invitationUrl && (
        <div className="invite-link-wrap">
          <div className="hint-text">Guest HTTPS link</div>
          <div className="invite-link-text" title={invitationUrl}>{invitationUrl}</div>
        </div>
      )}
      {invitationUrl && <button onClick={() => void copyInvitation()}>{copied === 'link' ? 'Copied' : 'Copy link'}</button>}
      <span className={`signaling-badge signaling-${signalingStatus}`}>
        {signalingStatus === 'reconnecting' || signalingStatus === 'resuming' ? `${signalingStatus} ${reconnectAttempts}` : signalingStatus}
      </span>
      <div className="hint-text" style={{ marginTop: 0 }}>{nickname}</div>
      <button className="danger" onClick={onLeave}>Leave</button>
    </div>
  );
}
