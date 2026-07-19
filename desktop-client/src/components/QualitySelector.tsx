import type { ActiveQuality, FpsOption, ResolutionTier } from '../../../shared/types';
import type { NetworkStats } from '../lib/peerManager';

interface Props {
  isHost: boolean;
  quality: ActiveQuality;
  onChange: (quality: ActiveQuality) => void;
  networkStats?: NetworkStats | null;
  isSharing?: boolean;
}

const RESOLUTIONS: ResolutionTier[] = [360, 480, 720, 1080, 1440];
const FPS_OPTIONS: FpsOption[] = [15, 30, 45, 60];

export function QualitySelector({ isHost, quality, onChange, networkStats, isSharing }: Props) {
  const isAuto = quality.mode === 'auto';

  return (
    <div className="panel">
      <h3>Stream quality</h3>
      {isHost ? (
        <>
          <label className="auto-toggle-row">
            <input
              type="checkbox"
              checked={isAuto}
              onChange={(e) => onChange({ ...quality, mode: e.target.checked ? 'auto' : 'manual' })}
            />
            <span>Auto (adjusts itself to the connection)</span>
          </label>
          <div className="quality-row">
            <label>Resolution</label>
            <select
              disabled={isAuto}
              value={quality.resolutionTier}
              onChange={(e) => onChange({ ...quality, resolutionTier: Number(e.target.value) as ResolutionTier })}
            >
              {RESOLUTIONS.map((r) => (
                <option key={r} value={r}>{r}p</option>
              ))}
            </select>
          </div>
          <div className="quality-row">
            <label>Frame rate</label>
            <select
              disabled={isAuto}
              value={quality.fps}
              onChange={(e) => onChange({ ...quality, fps: Number(e.target.value) as FpsOption })}
            >
              {FPS_OPTIONS.map((f) => (
                <option key={f} value={f}>{f} fps</option>
              ))}
            </select>
          </div>
          <div className="quality-row">
            <label>Prioritize</label>
            <select
              value={quality.prioritize}
              onChange={(e) => onChange({ ...quality, prioritize: e.target.value as 'clarity' | 'smoothness' })}
            >
              <option value="smoothness">Smoothness</option>
              <option value="clarity">Clarity</option>
            </select>
          </div>
        </>
      ) : (
        <div>{quality.resolutionTier}p · {quality.fps}fps · {quality.prioritize === 'clarity' ? 'clarity' : 'smoothness'}-priority{isAuto ? ' · auto' : ''}</div>
      )}

      {isSharing && networkStats && (
        <div className="network-stats-row">
          Loss: {networkStats.lossPct.toFixed(1)}% · RTT: {Math.round(networkStats.rttMs)}ms
          {' · '}{networkStats.transport}{networkStats.bitrateKbps > 0 ? ` · ${Math.round(networkStats.bitrateKbps)} kbps` : ''}
          {networkStats.width && networkStats.height ? ` · ${networkStats.width}×${networkStats.height}` : ''}
          {networkStats.fps ? ` @ ${networkStats.fps.toFixed(0)}fps` : ''}
          {isAuto && networkStats.lossPct > 3 && <span className="stat-bad"> — stepping down</span>}
        </div>
      )}

      <div className="hint-text">
        {isAuto
          ? 'Auto mode watches real packet loss/latency and steps resolution+fps up or down on its own.'
          : "Higher isn't automatically smoother: if it stutters, try lowering resolution or fps rather than raising them — or switch on Auto."}
      </div>
    </div>
  );
}
