import type { ControlInputEvent, ControlSessionDescriptor, DesktopMonitorTarget } from './controlState';

export function isTauriDesktop(): boolean {
  return '__TAURI_INTERNALS__' in window;
}

export async function listDesktopMonitors(): Promise<DesktopMonitorTarget[]> {
  if (!isTauriDesktop()) return [];
  const { availableMonitors } = await import('@tauri-apps/api/window');
  const monitors = await availableMonitors();
  return monitors.map((monitor, index) => ({
    id: `${monitor.position.x}:${monitor.position.y}:${monitor.size.width}:${monitor.size.height}`,
    label: monitor.name || `Monitor ${index + 1}`,
    x: monitor.position.x,
    y: monitor.position.y,
    width: monitor.size.width,
    height: monitor.size.height,
  }));
}

export async function startDesktopControlSession(session: ControlSessionDescriptor, target: DesktopMonitorTarget): Promise<void> {
  if (!isTauriDesktop()) throw new Error('Remote input is available only in the desktop host.');
  const { invoke } = await import('@tauri-apps/api/core');
  await invoke('start_control_session', {
    sessionId: session.sessionId,
    nonce: session.nonce,
    expiresAtMs: session.expiresAt,
    allowKeyboard: session.capabilities.keyboard,
    target: { x: target.x, y: target.y, width: target.width, height: target.height },
  });
}

export async function applyDesktopControlEvent(session: ControlSessionDescriptor, sequence: number, event: ControlInputEvent): Promise<void> {
  const { invoke } = await import('@tauri-apps/api/core');
  await invoke('apply_control_event', { sessionId: session.sessionId, nonce: session.nonce, sequence, event });
}

export async function heartbeatDesktopControl(session: ControlSessionDescriptor, sequence: number): Promise<void> {
  const { invoke } = await import('@tauri-apps/api/core');
  await invoke('control_heartbeat', { sessionId: session.sessionId, nonce: session.nonce, sequence });
}

export async function stopDesktopControlSession(sessionId?: string): Promise<void> {
  if (!isTauriDesktop()) return;
  const { invoke } = await import('@tauri-apps/api/core');
  await invoke('stop_control_session', { sessionId: sessionId ?? null });
}

export async function onDesktopEmergencyStop(callback: () => void): Promise<() => void> {
  if (!isTauriDesktop()) return () => undefined;
  const { listen } = await import('@tauri-apps/api/event');
  return listen('control-emergency-stop', callback);
}
