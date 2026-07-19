import type { ClientToServerMessage, ServerToClientMessage } from '../../../shared/protocol';
import { parseServerMessage } from '../../../shared/protocol';
import { calculateReconnectDelay, initialConnectionPolicy } from './webrtcState';

type Listener = (message: ServerToClientMessage) => void;
export type SignalingStatus = 'idle' | 'connecting' | 'waking' | 'connected' | 'reconnecting' | 'resuming' | 'failed' | 'closed';
type StatusListener = (status: SignalingStatus, attempt: number) => void;

const MAX_RECONNECT_ATTEMPTS = 6;
const MAX_QUEUED_MESSAGES = 100;

export class SignalingClient {
  private ws: WebSocket | null = null;
  private readonly listeners = new Set<Listener>();
  private readonly statusListeners = new Set<StatusListener>();
  private queue: ClientToServerMessage[] = [];
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private initialRetryTimer: ReturnType<typeof setTimeout> | null = null;
  private resolveInitialRetry: (() => void) | null = null;
  private resumeToken: string | null = null;
  private reconnectAttempts = 0;
  private manuallyClosed = false;
  private awaitingResume = false;
  private status: SignalingStatus = 'idle';

  constructor(private readonly url: string) {}

  async connect(): Promise<void> {
    this.manuallyClosed = false;
    this.reconnectAttempts = 0;
    const policy = initialConnectionPolicy(this.url);
    const deadline = Date.now() + policy.overallTimeoutMs;
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= policy.maxAttempts && !this.manuallyClosed; attempt += 1) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) break;
      this.reconnectAttempts = attempt - 1;
      this.setStatus(attempt > 1 && policy.showWakeState ? 'waking' : 'connecting');
      try {
        await this.openSocket(false, Math.min(policy.perAttemptTimeoutMs, remaining));
        return;
      } catch (error: unknown) {
        lastError = error instanceof Error ? error : new Error('The signaling connection failed.');
      }

      const afterAttempt = deadline - Date.now();
      if (attempt >= policy.maxAttempts || afterAttempt <= 0 || this.manuallyClosed) break;
      if (policy.showWakeState) this.setStatus('waking');
      const delay = Math.min(calculateReconnectDelay(attempt, 1_000, 8_000), afterAttempt);
      await this.waitForInitialRetry(delay);
    }

    this.setStatus('failed');
    const detail = lastError?.message ?? 'The connection attempt timed out.';
    throw new Error(`Signaling connection failed: ${detail}`);
  }

  private openSocket(isReconnect: boolean, connectTimeoutMs = 10_000): Promise<void> {
    if (this.ws?.readyState === WebSocket.OPEN) return Promise.resolve();
    if (isReconnect) this.setStatus('reconnecting');
    else if (this.status !== 'waking') this.setStatus('connecting');

    return new Promise((resolve, reject) => {
      const socket = new WebSocket(this.url);
      this.ws = socket;
      let opened = false;
      let settled = false;
      const finishInitialFailure = (message: string): void => {
        if (settled) return;
        settled = true;
        window.clearTimeout(connectTimer);
        if (this.ws === socket) this.ws = null;
        try {
          socket.close();
        } catch (error: unknown) {
          console.warn('[signaling] Could not close a failed initial socket.', error);
        }
        reject(new Error(message));
      };
      const connectTimer = window.setTimeout(() => {
        if (!opened) finishInitialFailure(`No WebSocket response within ${Math.ceil(connectTimeoutMs / 1_000)} seconds.`);
      }, connectTimeoutMs);
      socket.onopen = () => {
        if (settled) {
          socket.close();
          return;
        }
        settled = true;
        window.clearTimeout(connectTimer);
        opened = true;
        this.startHeartbeat();
        if (isReconnect && this.resumeToken) {
          this.awaitingResume = true;
          this.setStatus('resuming');
          socket.send(JSON.stringify({ type: 'resume-session', resumeToken: this.resumeToken } satisfies ClientToServerMessage));
        } else {
          this.awaitingResume = false;
          this.flushQueue();
          this.setStatus('connected');
        }
        resolve();
      };
      socket.onerror = () => {
        if (!opened) finishInitialFailure('The WebSocket endpoint rejected or could not establish the connection.');
      };
      socket.onmessage = (event) => this.handleMessage(event);
      socket.onclose = () => {
        if (this.ws === socket) this.ws = null;
        this.stopHeartbeat();
        this.awaitingResume = false;
        if (!opened) {
          finishInitialFailure('The WebSocket connection closed before it was ready.');
          return;
        }
        if (this.manuallyClosed) {
          this.setStatus('closed');
        } else if (this.resumeToken) {
          this.scheduleReconnect();
        } else {
          this.setStatus('failed');
        }
      };
    });
  }

  private waitForInitialRetry(delayMs: number): Promise<void> {
    this.cancelInitialRetry();
    return new Promise((resolve) => {
      this.resolveInitialRetry = resolve;
      this.initialRetryTimer = setTimeout(() => {
        this.initialRetryTimer = null;
        this.resolveInitialRetry = null;
        resolve();
      }, delayMs);
    });
  }

  private cancelInitialRetry(): void {
    if (this.initialRetryTimer) clearTimeout(this.initialRetryTimer);
    this.initialRetryTimer = null;
    const resolve = this.resolveInitialRetry;
    this.resolveInitialRetry = null;
    resolve?.();
  }

  private handleMessage(event: MessageEvent): void {
    if (typeof event.data !== 'string') {
      console.warn('[signaling] Ignored a non-text server message.');
      return;
    }
    const message = parseServerMessage(event.data);
    if (!message) {
      console.warn('[signaling] Ignored an invalid server message.');
      return;
    }
    if (message.type === 'pong') return;
    if (message.type === 'room-created' || message.type === 'room-joined') {
      this.resumeToken = message.resumeToken;
      this.reconnectAttempts = 0;
      this.setStatus('connected');
    } else if (message.type === 'session-resumed') {
      this.awaitingResume = false;
      this.reconnectAttempts = 0;
      this.flushQueue();
      this.setStatus('connected');
    } else if (message.type === 'error' && this.awaitingResume && message.code === 'ROOM_NOT_FOUND') {
      this.awaitingResume = false;
      this.resumeToken = null;
      this.queue = [];
      this.setStatus('failed');
    }
    this.listeners.forEach((listener) => listener(message));
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer || this.manuallyClosed) return;
    if (this.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      this.setStatus('failed');
      return;
    }
    this.reconnectAttempts += 1;
    this.setStatus('reconnecting');
    const delay = calculateReconnectDelay(this.reconnectAttempts, 500, 8_000);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.openSocket(true).catch((error: unknown) => {
        console.warn('[signaling] Reconnect attempt failed.', error);
        this.scheduleReconnect();
      });
    }, delay);
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN && !this.awaitingResume) {
        this.ws.send(JSON.stringify({ type: 'ping' } satisfies ClientToServerMessage));
      }
    }, 25_000);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
  }

  private flushQueue(): void {
    const socket = this.ws;
    if (!socket || socket.readyState !== WebSocket.OPEN || this.awaitingResume) return;
    const pending = this.queue;
    this.queue = [];
    for (const message of pending) socket.send(JSON.stringify(message));
  }

  private setStatus(status: SignalingStatus): void {
    if (this.status === status && status !== 'reconnecting' && status !== 'waking') return;
    this.status = status;
    this.statusListeners.forEach((listener) => listener(status, this.reconnectAttempts));
  }

  onMessage(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  onStatus(listener: StatusListener): () => void {
    this.statusListeners.add(listener);
    listener(this.status, this.reconnectAttempts);
    return () => this.statusListeners.delete(listener);
  }

  send(message: ClientToServerMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN && !this.awaitingResume) {
      this.ws.send(JSON.stringify(message));
      return;
    }
    if (message.type === 'ping') return;
    if (this.queue.length >= MAX_QUEUED_MESSAGES) {
      console.warn('[signaling] Queue limit reached; dropping the oldest pending message.');
      this.queue.shift();
    }
    this.queue.push(message);
  }

  close(): void {
    this.manuallyClosed = true;
    this.cancelInitialRetry();
    this.resumeToken = null;
    this.awaitingResume = false;
    this.queue = [];
    this.stopHeartbeat();
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.ws?.close(1000, 'Client closed');
    this.ws = null;
    this.setStatus('closed');
  }
}
