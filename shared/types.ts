/**
 * Shared types for the P2P watch/support/control app.
 * Used by both the signaling-server and the desktop-client.
 *
 * IMPORTANT SEPARATION OF CONCERNS:
 * - Preset            = permissions & control profile (mouse/keyboard/chat/UI actions)
 * - VideoQualityProfile = stream quality (resolution tier + FPS), NOT permissions
 * - Role              = base capabilities of Host / Guest / Viewer
 * These are independent entities that get combined per-participant in a Room.
 */

// ---------- Presets: access & control profile ----------

export interface MouseButtons {
  left: boolean;
  right: boolean;
  middle: boolean;
}

export interface Preset {
  id: string;
  name: string; // "Watch Together", "Support Lite", "Full Control", "Custom #1"
  description?: string;

  // General access flags
  canViewScreen: boolean; // almost always true
  canUseMouse: boolean;
  canUseKeyboard: boolean;
  canUseChat: boolean;
  canUseMediaControls: boolean; // play/pause/seek/next/prev

  // Keyboard detail
  allowedKeys?: string[]; // e.g. ['Space', 'ArrowLeft', 'ArrowRight', 'Enter', 'Escape']
  blockedKeys?: string[]; // takes priority over allowedKeys
  allowedKeyGroups?: KeyGroup[];

  // Mouse detail
  mouseButtons?: MouseButtons;
  allowScroll: boolean;
  allowDrag: boolean;

  // UI actions available to this preset
  allowedUiActions?: UiAction[];

  // Access behavior
  requireExplicitApproval: boolean; // must the screen owner click Allow?
  autoRevokeMs?: number; // e.g. 120000 = auto-revoke control after 2 min idle
  showControlIndicator: boolean; // "X is controlling your screen" banner

  // Metadata
  createdBy: string;
  createdAt: string; // ISO date
  updatedAt?: string;
}

export type KeyGroup =
  | 'arrows'
  | 'media'
  | 'function'
  | 'numbers'
  | 'letters';

export type UiAction =
  | 'play'
  | 'pause'
  | 'seek'
  | 'mute'
  | 'unmute'
  | 'endSession'
  | 'requestControl';

// Built-in preset templates the app ships with (users can clone/customize)
export const BUILTIN_PRESETS: Omit<Preset, 'createdBy' | 'createdAt'>[] = [
  {
    id: 'watch-together',
    name: 'Watch Together',
    description: 'Media controls and chat only. No mouse/keyboard.',
    canViewScreen: true,
    canUseMouse: false,
    canUseKeyboard: false,
    canUseChat: true,
    canUseMediaControls: true,
    allowedKeyGroups: ['media', 'arrows'],
    allowScroll: false,
    allowDrag: false,
    allowedUiActions: ['play', 'pause', 'seek', 'mute', 'unmute'],
    requireExplicitApproval: false,
    showControlIndicator: true,
  },
  {
    id: 'support-lite',
    name: 'Support Lite',
    description: 'Mouse + limited keys, no free typing. Good for quick help.',
    canViewScreen: true,
    canUseMouse: true,
    canUseKeyboard: true,
    canUseChat: true,
    canUseMediaControls: false,
    allowedKeys: ['Enter', 'Escape', 'Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'],
    mouseButtons: { left: true, right: true, middle: false },
    allowScroll: true,
    allowDrag: true,
    allowedUiActions: ['requestControl', 'endSession'],
    requireExplicitApproval: true,
    autoRevokeMs: 5 * 60 * 1000,
    showControlIndicator: true,
  },
  {
    id: 'full-control',
    name: 'Full Control',
    description: 'Full mouse + keyboard after explicit approval.',
    canViewScreen: true,
    canUseMouse: true,
    canUseKeyboard: true,
    canUseChat: true,
    canUseMediaControls: true,
    mouseButtons: { left: true, right: true, middle: true },
    allowScroll: true,
    allowDrag: true,
    allowedUiActions: ['play', 'pause', 'seek', 'mute', 'unmute', 'requestControl', 'endSession'],
    requireExplicitApproval: true,
    showControlIndicator: true,
  },
  {
    id: 'view-only',
    name: 'View Only',
    description: 'Just watch. Chat only, no control of any kind.',
    canViewScreen: true,
    canUseMouse: false,
    canUseKeyboard: false,
    canUseChat: true,
    canUseMediaControls: false,
    allowScroll: false,
    allowDrag: false,
    requireExplicitApproval: false,
    showControlIndicator: false,
  },
];

// ---------- Roles ----------

export type RoleId = 'host' | 'guest' | 'viewer';

export interface Role {
  id: RoleId;
  name: string;
  description: string;
  canStartCall: boolean;
  canEndCall: boolean;
  canShareScreen: boolean;
  canGrantControl: boolean;
  canRevokeControl: boolean;
  canChangePreset: boolean;
  canChangeQuality: boolean;
}

export const ROLES: Record<RoleId, Role> = {
  host: {
    id: 'host',
    name: 'Host',
    description: 'Creates the room, shares screen, manages presets/quality/access.',
    canStartCall: true,
    canEndCall: true,
    canShareScreen: true,
    canGrantControl: true,
    canRevokeControl: true,
    canChangePreset: true,
    canChangeQuality: true,
  },
  guest: {
    id: 'guest',
    name: 'Guest',
    description: 'Can request control within the preset granted by the host.',
    canStartCall: false,
    canEndCall: false,
    canShareScreen: false,
    canGrantControl: false,
    canRevokeControl: false,
    canChangePreset: false,
    canChangeQuality: false,
  },
  viewer: {
    id: 'viewer',
    name: 'Viewer',
    description: 'Watches only, can optionally use chat.',
    canStartCall: false,
    canEndCall: false,
    canShareScreen: false,
    canGrantControl: false,
    canRevokeControl: false,
    canChangePreset: false,
    canChangeQuality: false,
  },
};

// ---------- Video quality (independent of Preset) ----------

export type ResolutionTier = 360 | 480 | 720 | 1080 | 1440;
export type FpsOption = 15 | 30 | 45 | 60;

export interface VideoQualityProfile {
  id: string;
  name: string; // "Low", "Balanced", "Sharp", "Ultra", "Custom #1"
  description?: string;
  resolutionTier: ResolutionTier;
  fps: FpsOption;
  mode: 'manual' | 'auto';
  preserveAspectRatio: true; // always true by design — never force 16:9
  prioritize: 'clarity' | 'smoothness';
  createdBy: string;
  createdAt: string;
}

export const BUILTIN_QUALITY_PROFILES: Omit<VideoQualityProfile, 'createdBy' | 'createdAt'>[] = [
  { id: 'low', name: 'Low', resolutionTier: 360, fps: 15, mode: 'manual', preserveAspectRatio: true, prioritize: 'smoothness' },
  { id: 'balanced', name: 'Balanced', resolutionTier: 480, fps: 30, mode: 'manual', preserveAspectRatio: true, prioritize: 'smoothness' },
  { id: 'sharp', name: 'Sharp', resolutionTier: 1080, fps: 30, mode: 'manual', preserveAspectRatio: true, prioritize: 'clarity' },
  { id: 'ultra', name: 'Ultra', resolutionTier: 1440, fps: 60, mode: 'manual', preserveAspectRatio: true, prioritize: 'clarity' },
];

/** Resolves a resolution tier to a target *long-side* pixel size (not a fixed 16:9 box). */
export function tierToTargetLongSide(tier: ResolutionTier): number {
  switch (tier) {
    case 360: return 640;
    case 480: return 854;
    case 720: return 1280;
    case 1080: return 1920;
    case 1440: return 2560;
  }
}

/**
 * Generous bitrate CEILING (kbps) per resolution tier — not a forced
 * constant rate. WebRTC's own congestion control still adapts the actual
 * send rate down in real time based on network feedback; this just makes
 * sure the encoder isn't needlessly capped below what a good connection
 * could actually sustain. Raising this doesn't fix a genuinely weak link —
 * on a constrained connection a *lower* resolution/fps choice (which needs
 * less bitrate in the first place) is what actually reduces lag.
 */
export function tierToMaxBitrateKbps(tier: ResolutionTier): number {
  switch (tier) {
    case 360: return 700;
    case 480: return 1300;
    case 720: return 2500;
    case 1080: return 5000;
    case 1440: return 8500;
  }
}

// ---------- Room / Participant ----------

export interface Participant {
  id: string;
  nickname: string;
  roleId: RoleId;
  appliedPresetId?: string; // can override the room's default preset per-participant
}

/** Resolution and FPS are freely combinable — this isn't one of the 4
 * named presets, it's whatever the host actually picked (which may or may
 * not match a preset). 'auto' mode means the app adjusts resolution/fps
 * itself in real time based on measured connection quality, rather than
 * the host picking a fixed combo. */
export interface ActiveQuality {
  resolutionTier: ResolutionTier;
  fps: FpsOption;
  prioritize: 'clarity' | 'smoothness';
  mode: 'manual' | 'auto';
}

// A good visual default for screen/video sharing. Auto mode can quickly step
// down from here on a weak connection, while a healthy connection no longer
// starts with visibly choppy 360p/15fps video.
export const DEFAULT_ACTIVE_QUALITY: ActiveQuality = { resolutionTier: 720, fps: 30, prioritize: 'smoothness', mode: 'auto' };

export interface Room {
  id: string;
  code: string; // human-entered room code
  hostId: string;
  participants: Participant[];
  activePresetId?: string;
  activeQuality?: ActiveQuality;
  createdAt: string;
}
