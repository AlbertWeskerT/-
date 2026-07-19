import { BUILTIN_PRESETS } from '../../../shared/types';

interface Props {
  isHost: boolean;
  activePresetId?: string;
  onChange: (presetId: string) => void;
}

export function PresetSelector({ isHost, activePresetId, onChange }: Props) {
  const active = BUILTIN_PRESETS.find((p) => p.id === activePresetId) ?? BUILTIN_PRESETS[0];

  return (
    <div className="panel">
      <h3>Access preset</h3>
      {isHost ? (
        <select
          className="preset-select"
          value={activePresetId ?? BUILTIN_PRESETS[0].id}
          onChange={(e) => onChange(e.target.value)}
        >
          {BUILTIN_PRESETS.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
      ) : (
        <div>{active.name}</div>
      )}
      <div className="hint-text">{active.description}</div>
    </div>
  );
}
