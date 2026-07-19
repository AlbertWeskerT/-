import type { SerializableIceCandidate } from '../../../shared/protocol';

export function calculateReconnectDelay(attempt: number, baseMs = 750, maxMs = 10_000): number {
  const boundedAttempt = Math.max(1, Math.floor(attempt));
  return Math.min(maxMs, baseMs * 2 ** (boundedAttempt - 1));
}

export interface InitialConnectionPolicy {
  maxAttempts: number;
  overallTimeoutMs: number;
  perAttemptTimeoutMs: number;
  showWakeState: boolean;
}

export function initialConnectionPolicy(url: string): InitialConnectionPolicy {
  let isRenderService = false;
  try {
    isRenderService = new URL(url).hostname.toLowerCase().endsWith('.onrender.com');
  } catch {
    // URL validation is handled by runtimeConfig before signaling begins.
  }
  return isRenderService
    ? { maxAttempts: 12, overallTimeoutMs: 70_000, perAttemptTimeoutMs: 10_000, showWakeState: true }
    : { maxAttempts: 2, overallTimeoutMs: 12_000, perAttemptTimeoutMs: 8_000, showWakeState: false };
}

export interface OfferCollisionInput {
  descriptionType: 'offer' | 'answer';
  polite: boolean;
  makingOffer: boolean;
  signalingState: RTCSignalingState;
  isSettingRemoteAnswerPending: boolean;
}

export interface OfferCollisionDecision {
  collision: boolean;
  ignore: boolean;
}

export function decideOfferCollision(input: OfferCollisionInput): OfferCollisionDecision {
  const readyForOffer = !input.makingOffer && (input.signalingState === 'stable' || input.isSettingRemoteAnswerPending);
  const collision = input.descriptionType === 'offer' && !readyForOffer;
  return { collision, ignore: !input.polite && collision };
}

export class IceCandidateQueue {
  private candidates: SerializableIceCandidate[] = [];

  add(candidate: SerializableIceCandidate): void {
    this.candidates.push(candidate);
  }

  drain(): SerializableIceCandidate[] {
    const pending = this.candidates;
    this.candidates = [];
    return pending;
  }

  clear(): void {
    this.candidates = [];
  }

  get size(): number {
    return this.candidates.length;
  }
}
