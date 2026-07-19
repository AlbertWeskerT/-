# Testing

## Automated commands

```powershell
npm run typecheck
npm run lint
npm test
npm run test:e2e
npm run diagnostics
cargo check --manifest-path desktop-client/src-tauri/Cargo.toml
npm run desktop:build
npm run desktop:package
```

## Coverage

- Unit: protocol parsing, room limits/invites/history, ICE queue/collision logic, reconnect delays, audio level, drawing, control messages, room links and media synchronization.
- Integration: invalid payload resilience, host close grace, same-session resume, invite/TURN/chat recovery, cross-room and host-only boundaries.
- Browser E2E: built SPA/static routing, two independent Edge contexts, invite link, fake microphone tracks, WebRTC screen track, backend chat, data-channel drawing, signaling reconnect and control request delivery.
- Native: Rust compilation and Tauri release/package build.

The E2E fake devices prove browser media plumbing and negotiation, not physical speaker quality, real system-audio capture, TURN traversal over the public internet or real Windows input on a second machine. Those remain manual checks.
