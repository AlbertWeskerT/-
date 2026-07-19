export interface RuntimeConfig {
  signalingUrl: string;
  publicAppUrl: string;
}

const STORAGE_KEY = 'watch-together.runtime-config.v1';

export function hasEmbeddedRuntimeConfig(): boolean {
  return Boolean(import.meta.env.VITE_SIGNALING_URL && import.meta.env.VITE_PUBLIC_APP_URL);
}

export function isTauriRuntime(): boolean {
  return '__TAURI_INTERNALS__' in window;
}

function sameOriginSignalingUrl(): string {
  const scheme = window.location.protocol === 'https:' ? 'wss://' : 'ws://';
  const port = window.location.port === '1420' ? '8787' : window.location.port;
  return `${scheme}${window.location.hostname}${port ? `:${port}` : ''}/ws`;
}

function normalizeWebSocketUrl(value: string): string {
  const url = new URL(value.trim());
  if (url.protocol !== 'ws:' && url.protocol !== 'wss:') throw new Error('Signaling URL must start with ws:// or wss://.');
  if (import.meta.env.PROD && url.protocol !== 'wss:') throw new Error('Production signaling URL must use wss://.');
  return url.toString();
}

function normalizePublicUrl(value: string): string {
  const url = new URL(value.trim());
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('Public app URL must use http:// or https://.');
  if (import.meta.env.PROD && url.protocol !== 'https:') throw new Error('Production public app URL must use https://.');
  return url.toString().replace(/\/$/, '');
}

export function loadRuntimeConfig(): RuntimeConfig | null {
  const environmentSignaling = import.meta.env.VITE_SIGNALING_URL;
  const environmentPublicApp = import.meta.env.VITE_PUBLIC_APP_URL;
  if (environmentSignaling) {
    try {
      return {
        signalingUrl: normalizeWebSocketUrl(environmentSignaling),
        publicAppUrl: normalizePublicUrl(environmentPublicApp ?? window.location.origin),
      };
    } catch (error: unknown) {
      console.error('[config] Invalid build-time runtime configuration.', error);
      return null;
    }
  }

  if (import.meta.env.DEV || !isTauriRuntime()) return { signalingUrl: sameOriginSignalingUrl(), publicAppUrl: window.location.origin };

  const stored = localStorage.getItem(STORAGE_KEY);
  if (!stored) return null;
  try {
    const decoded = JSON.parse(stored) as Partial<RuntimeConfig>;
    if (typeof decoded.signalingUrl !== 'string' || typeof decoded.publicAppUrl !== 'string') return null;
    return { signalingUrl: normalizeWebSocketUrl(decoded.signalingUrl), publicAppUrl: normalizePublicUrl(decoded.publicAppUrl) };
  } catch (error: unknown) {
    console.warn('[config] Stored desktop configuration is invalid.', error);
    return null;
  }
}

export function saveRuntimeConfig(config: RuntimeConfig): RuntimeConfig {
  const normalized = {
    signalingUrl: normalizeWebSocketUrl(config.signalingUrl),
    publicAppUrl: normalizePublicUrl(config.publicAppUrl),
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
  return normalized;
}

export function clearStoredRuntimeConfig(): void {
  localStorage.removeItem(STORAGE_KEY);
}
