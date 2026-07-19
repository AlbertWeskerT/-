import { useState } from 'react';
import { saveRuntimeConfig, type RuntimeConfig } from '../lib/runtimeConfig';

interface Props {
  onConfigured: (config: RuntimeConfig) => void;
}

export function DesktopSetup({ onConfigured }: Props) {
  const [signalingUrl, setSignalingUrl] = useState('');
  const [publicAppUrl, setPublicAppUrl] = useState('');
  const [error, setError] = useState<string | null>(null);

  function handleSubmit(event: React.FormEvent): void {
    event.preventDefault();
    try {
      const config = saveRuntimeConfig({ signalingUrl, publicAppUrl });
      setError(null);
      onConfigured(config);
    } catch (configurationError: unknown) {
      setError(configurationError instanceof Error ? configurationError.message : 'Configuration is invalid.');
    }
  }

  return (
    <div className="app-shell">
      <div className="join-card">
        <div className="eyebrow">Desktop configuration</div>
        <h1>Network configuration is missing</h1>
        <p className="hint-text">Install the official production build. It includes the public service address and does not require manual setup.</p>
        <details className="developer-settings">
          <summary>Developer Settings</summary>
          <form onSubmit={handleSubmit}>
            <p className="hint-text">Manual endpoints are intended only for development and diagnostics.</p>
            {error && <div className="error-banner">{error}</div>}
            <div className="field">
              <label htmlFor="signaling-url">Signaling URL</label>
              <input id="signaling-url" value={signalingUrl} onChange={(event) => setSignalingUrl(event.target.value)} placeholder="wss://signal.example.com/ws" />
            </div>
            <div className="field">
              <label htmlFor="public-app-url">Guest website URL</label>
              <input id="public-app-url" value={publicAppUrl} onChange={(event) => setPublicAppUrl(event.target.value)} placeholder="https://watch.example.com" />
            </div>
            <button className="primary" type="submit" disabled={!signalingUrl.trim() || !publicAppUrl.trim()}>Save developer endpoints</button>
          </form>
        </details>
      </div>
    </div>
  );
}
