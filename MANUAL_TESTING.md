# Manual testing checklist

Use two physical Windows computers on different networks for the production pass.

## Room and deployment

- [ ] Open the permanent HTTPS site from both computers.
- [ ] Create a room in desktop-host, copy its `/room/...` link and join from Chrome/Edge.
- [ ] Refresh the guest link and rejoin while the host remains present.
- [ ] Confirm a closed/expired room shows a clear error.

## Voice and screen

- [ ] Select and switch real microphones on both sides.
- [ ] Verify bidirectional audible voice, mute/unmute and speaking indicators.
- [ ] Share/stop/re-share a monitor repeatedly.
- [ ] Verify a late guest receives the already active screen stream.
- [ ] Test monitor, window and browser-tab sources where supported.
- [ ] Verify real system audio only when the source picker explicitly includes it.
- [ ] Test autoplay recovery and fullscreen.

## Network

- [ ] Confirm direct connectivity on a normal network.
- [ ] Force a restrictive/different network and confirm `relayed` with the configured TURN server.
- [ ] Interrupt Wi-Fi briefly and confirm signaling resumes without duplicate participants.
- [ ] Leave the room open long enough to renew ICE credentials and admit another guest.

## Drawing, chat and video

- [ ] Draw from host and guest at different window sizes/fullscreen.
- [ ] Test pen, eraser, clear mine and host clear all.
- [ ] Send text and compressed images; reconnect and confirm history.
- [ ] Choose identical local videos on both devices; test play, pause, seek and drift correction.

## Remote control

- [ ] Share a full monitor from the installed desktop-host.
- [ ] Select the same monitor in the control panel.
- [ ] Request mouse-only control, approve, then test move/click/right/middle/scroll/drag.
- [ ] Request mouse+keyboard and test supported keys and modifiers.
- [ ] Verify no control event applies before approval or after revoke.
- [ ] Verify disconnect and expiry stop the session.
- [ ] Hold keys/buttons, stop control, and verify they are released.
- [ ] Minimize the host and use `Ctrl+Shift+F12`; verify immediate stop.
- [ ] Lock Windows and verify remote input cannot control the lock screen.

Record OS versions, app version, network type, direct/relay status and failures. Do not mark unchecked items as verified.
