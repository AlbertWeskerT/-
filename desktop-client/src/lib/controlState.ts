export interface ControlCapabilities {
  mouse: true;
  keyboard: boolean;
}

export interface ControlSessionDescriptor {
  sessionId: string;
  nonce: string;
  expiresAt: number;
  capabilities: ControlCapabilities;
}

export interface DesktopMonitorTarget {
  id: string;
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export type ControlInputEvent =
  | { type: 'mouseMove'; x: number; y: number }
  | { type: 'mouseButton'; button: 'left' | 'right' | 'middle'; action: 'down' | 'up'; x: number; y: number }
  | { type: 'mouseScroll'; deltaX: number; deltaY: number; x: number; y: number }
  | { type: 'key'; code: string; action: 'down' | 'up' }
  | { type: 'releaseAll' };

export type ControlSessionMessage =
  | { kind: 'control-request'; requestId: string; capabilities: ControlCapabilities; requestedAt: number }
  | { kind: 'control-response'; requestId: string; approved: false; reason: string }
  | { kind: 'control-response'; requestId: string; approved: true; session: ControlSessionDescriptor }
  | { kind: 'control-event'; sessionId: string; nonce: string; sequence: number; event: ControlInputEvent }
  | { kind: 'control-heartbeat'; sessionId: string; nonce: string; sequence: number }
  | { kind: 'control-revoked'; sessionId: string; reason: 'host-stopped' | 'guest-stopped' | 'disconnect' | 'expired' | 'emergency-stop' };

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const NONCE_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const KEY_CODE_PATTERN = /^(?:Key[A-Z]|Digit[0-9]|F(?:[1-9]|1[0-2])|Enter|Escape|Tab|Space|Backspace|Delete|Insert|Home|End|PageUp|PageDown|ArrowUp|ArrowDown|ArrowLeft|ArrowRight|ShiftLeft|ShiftRight|ControlLeft|ControlRight|AltLeft|AltRight)$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNormalized(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
}

function parseCapabilities(value: unknown): ControlCapabilities | null {
  if (!isRecord(value) || value.mouse !== true || typeof value.keyboard !== 'boolean') return null;
  return { mouse: true, keyboard: value.keyboard };
}

function parseInputEvent(value: unknown): ControlInputEvent | null {
  if (!isRecord(value) || typeof value.type !== 'string') return null;
  if (value.type === 'mouseMove' && isNormalized(value.x) && isNormalized(value.y)) return { type: 'mouseMove', x: value.x, y: value.y };
  if (
    value.type === 'mouseButton'
    && (value.button === 'left' || value.button === 'right' || value.button === 'middle')
    && (value.action === 'down' || value.action === 'up')
    && isNormalized(value.x)
    && isNormalized(value.y)
  ) return { type: 'mouseButton', button: value.button, action: value.action, x: value.x, y: value.y };
  if (
    value.type === 'mouseScroll'
    && typeof value.deltaX === 'number'
    && Number.isFinite(value.deltaX)
    && Math.abs(value.deltaX) <= 2_000
    && typeof value.deltaY === 'number'
    && Number.isFinite(value.deltaY)
    && Math.abs(value.deltaY) <= 2_000
    && isNormalized(value.x)
    && isNormalized(value.y)
  ) return { type: 'mouseScroll', deltaX: value.deltaX, deltaY: value.deltaY, x: value.x, y: value.y };
  if (value.type === 'key' && typeof value.code === 'string' && KEY_CODE_PATTERN.test(value.code) && (value.action === 'down' || value.action === 'up')) {
    return { type: 'key', code: value.code, action: value.action };
  }
  if (value.type === 'releaseAll') return { type: 'releaseAll' };
  return null;
}

export function parseControlSessionMessage(value: Record<string, unknown>): ControlSessionMessage | null {
  if (value.kind === 'control-request') {
    const capabilities = parseCapabilities(value.capabilities);
    if (!UUID_PATTERN.test(String(value.requestId)) || !capabilities || typeof value.requestedAt !== 'number' || !Number.isFinite(value.requestedAt)) return null;
    return { kind: 'control-request', requestId: String(value.requestId), capabilities, requestedAt: value.requestedAt };
  }
  if (value.kind === 'control-response') {
    if (!UUID_PATTERN.test(String(value.requestId)) || typeof value.approved !== 'boolean') return null;
    if (!value.approved) {
      if (typeof value.reason !== 'string' || value.reason.length > 120) return null;
      return { kind: 'control-response', requestId: String(value.requestId), approved: false, reason: value.reason };
    }
    if (!isRecord(value.session)) return null;
    const capabilities = parseCapabilities(value.session.capabilities);
    if (
      !UUID_PATTERN.test(String(value.session.sessionId))
      || !NONCE_PATTERN.test(String(value.session.nonce))
      || typeof value.session.expiresAt !== 'number'
      || !Number.isFinite(value.session.expiresAt)
      || !capabilities
    ) return null;
    return {
      kind: 'control-response', requestId: String(value.requestId), approved: true,
      session: { sessionId: String(value.session.sessionId), nonce: String(value.session.nonce), expiresAt: value.session.expiresAt, capabilities },
    };
  }
  if (value.kind === 'control-event') {
    const event = parseInputEvent(value.event);
    if (!UUID_PATTERN.test(String(value.sessionId)) || !NONCE_PATTERN.test(String(value.nonce)) || !Number.isInteger(value.sequence) || Number(value.sequence) < 1 || !event) return null;
    return { kind: 'control-event', sessionId: String(value.sessionId), nonce: String(value.nonce), sequence: Number(value.sequence), event };
  }
  if (value.kind === 'control-heartbeat') {
    if (!UUID_PATTERN.test(String(value.sessionId)) || !NONCE_PATTERN.test(String(value.nonce)) || !Number.isInteger(value.sequence) || Number(value.sequence) < 1) return null;
    return { kind: 'control-heartbeat', sessionId: String(value.sessionId), nonce: String(value.nonce), sequence: Number(value.sequence) };
  }
  if (value.kind === 'control-revoked') {
    const reasons = ['host-stopped', 'guest-stopped', 'disconnect', 'expired', 'emergency-stop'];
    if (!UUID_PATTERN.test(String(value.sessionId)) || typeof value.reason !== 'string' || !reasons.includes(value.reason)) return null;
    return { kind: 'control-revoked', sessionId: String(value.sessionId), reason: value.reason as Extract<ControlSessionMessage, { kind: 'control-revoked' }>['reason'] };
  }
  return null;
}

export function createControlNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return target.matches('input, textarea, select, [contenteditable="true"], [contenteditable=""]') || Boolean(target.closest('[data-control-input-blocked]'));
}
