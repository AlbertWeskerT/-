# Security model

## Trust boundary

The signaling server accepts only validated protocol messages and authorizes actions against socket room membership. SDP/ICE targets must be members of the same room. Host-only room changes are checked server-side.

Room UUIDs, invite tokens and resume tokens are generated independently. Invite/resume token comparisons use stored hashes. Rooms, histories and tokens expire and are kept in memory only.

## Media and content

WebRTC transports media/data. Chat text is rendered as React text, images are re-encoded JPEG data URLs with size limits, and history is bounded. Drawing and synchronized-video messages validate coordinates, sizes, identifiers and sequence values.

## Remote control

Control is unavailable in a browser host. The desktop host requires a current room participant request and explicit approval. Sessions are short-lived, bound to one controller and selected monitor, and reject stale/mismatched events. Native state independently tracks expiry, heartbeat, rate and held inputs. Stop paths release virtual keys/buttons. The emergency hotkey is `Ctrl+Shift+F12`.

Control events are not captured while the guest types in application inputs, chat or settings. The protocol transmits key events, not recorded text. Shell, clipboard and file commands do not exist in the control protocol.

## TURN and deployment

TURN long-lived secrets remain on the backend. Participants receive time-limited credentials. Production should use HTTPS/WSS, a configured origin allowlist, an always-on backend and secret environment variables. Logs exclude chat, SDP, ICE candidates, tokens and control payloads.

Report security issues privately to the project owner; do not include active room links, tokens or credentials in a public issue.
