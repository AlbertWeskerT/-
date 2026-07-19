export type MicrophonePermissionState = 'unknown' | 'prompt' | 'granted' | 'denied' | 'unavailable';

interface Props {
  devices: MediaDeviceInfo[];
  selectedDeviceId: string;
  micOn: boolean;
  level: number;
  speaking: boolean;
  permission: MicrophonePermissionState;
  onToggle: () => void;
  onDeviceChange: (deviceId: string) => void;
}

export function MicrophoneControls({
  devices,
  selectedDeviceId,
  micOn,
  level,
  speaking,
  permission,
  onToggle,
  onDeviceChange,
}: Props) {
  return (
    <div className="microphone-controls">
      <button className={micOn ? '' : 'muted'} onClick={onToggle}>
        {micOn ? '🎙️ Mute' : '🎙️ Unmute'}
      </button>
      <select
        aria-label="Microphone device"
        value={selectedDeviceId}
        onChange={(event) => onDeviceChange(event.target.value)}
        disabled={permission === 'unavailable'}
      >
        <option value="">Default microphone</option>
        {devices.map((device, index) => (
          <option key={device.deviceId || `microphone-${index}`} value={device.deviceId}>
            {device.label || `Microphone ${index + 1}`}
          </option>
        ))}
      </select>
      <div className={`mic-level ${speaking ? 'speaking' : ''}`} title={`Microphone permission: ${permission}`}>
        <span style={{ width: `${micOn ? Math.round(level * 100) : 0}%` }} />
      </div>
      <span className="media-status">{permission === 'denied' ? 'permission denied' : micOn ? (speaking ? 'speaking' : 'on') : 'muted'}</span>
    </div>
  );
}
