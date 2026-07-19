# Architecture

## Components

- `signaling-server`: one Node.js process serving the production SPA, `/healthz`, `/readyz` and WebSocket `/ws`.
- `desktop-client`: one React application running either in Chrome/Edge or in Tauri. Tauri is the only host capable of applying OS input.
- `shared/protocol.ts`: canonical wire messages and runtime validation for client input.
- `PeerManager`: one `RTCPeerConnection` per remote participant with stable sender slots for microphone, screen video and screen audio.
- Native control runtime: Tauri commands, Windows input application, monitor mapping, release cleanup and emergency hotkey.

## Data flows

```text
Desktop host ── HTTPS/WSS ── Signaling server ── HTTPS/WSS ── Browser guests
      └──────────── WebRTC media + ordered data channels ────────────┘
```

The backend owns room membership, reconnect sessions, active preset/quality, chat history and temporary ICE configuration. SDP/ICE are relayed only inside the room. Media, drawing, synchronized playback and control events use peer data/media connections.

## Signaling and reconnect

The host creates a UUID room plus a human code and invite token. Each participant receives a separate resume token. A transient socket loss keeps room membership for a bounded grace period; resume attaches a new socket to the same participant ID. Peer connections remain alive and are not duplicated.

## Media

Each peer state has fixed semantic sender slots. Track changes use `replaceTrack`; negotiation uses the polite/impolite perfect-negotiation pattern. Remote audio streams are rendered per participant. Screen video constraints preserve source aspect ratio. Stats drive the optional quality ladder.

## Drawing and synchronized video

Drawing uses normalized `0..1` points, batched stroke segments and a canvas mapped to the actual contained-video rectangle. Local-video mode hashes bounded samples of the file, keeps files local and synchronizes host play/pause/seek/rate state using a measured clock offset.

## Remote control

A guest requests capabilities; the desktop host selects a monitor and explicitly approves. The active session has its own ID, nonce, expiry and monotonic sequence. Only the native host applies events. Disconnect, expiry, revoke, window exit or the global emergency hotkey ends the session and releases held inputs.

## Deployment

The recommended production topology is a single HTTPS origin serving both SPA and WSS. It makes `/room/...` refresh work without a separate rewrite service. TURN is a separate coturn-compatible service using shared-secret temporary credentials issued by signaling.

## Scaling boundary

Rooms are capped at four participants. Mesh upload and CPU grow per peer. Larger rooms should move media to an SFU while keeping the current room/protocol boundary.
