# Watch Together — итоговый отчёт

Дата: 19 июля 2026 года  
Проект: `p2p-app`  
Версия: `0.2.0`

## Итог

Работа выполнена по этапам `TASK.md`: аудит → signaling/backend → WebRTC/reconnect → media → desktop → UI и дополнительные функции → тесты → production deployment.

Проект опубликован:

- GitHub: `https://github.com/AlbertWeskerT/-`
- основной Render URL: `https://watch-together-p2p-ghost.onrender.com/`
- резервный web-клиент GitHub Pages: `https://albertweskert.github.io/-/`
- production WebSocket: `wss://watch-together-p2p-ghost.onrender.com/ws`

Render Blueprint `watch-together-p2p-ghost` подключён к ветке `main`, использует план Free и автоматически разворачивает новые коммиты. GitHub Pages собирается отдельным workflow и подключается к тому же Render signaling-server.

## Что было найдено

- frontend production build падал на `MediaTrackConstraints.latency`;
- signaling-server падал на корректном JSON-значении `null`;
- payload почти не проходил runtime-валидацию;
- reconnect/resume, heartbeat и очистка комнат были неполными;
- WebRTC negotiation, очередь ICE и повторная демонстрация экрана имели ошибки lifecycle;
- голос в mesh-комнате маршрутизировался неполно;
- media cleanup и состояние system audio были несогласованными;
- production desktop build, постоянная web-ссылка и deployment-конфигурация отсутствовали;
- TURN credentials предполагались в frontend-конфигурации;
- drawing, подтверждаемое remote control, backend chat history, synchronized local video и диагностика отсутствовали или были неполными;
- unit/integration/E2E покрытие было недостаточным;
- первый Linux build на Render и GitHub Pages не устанавливал `@rolldown/binding-linux-x64-gnu` из Windows-generated root lockfile;
- Linux TypeScript build обнаружил конфликт типа browser timer в `App.tsx`;
- GitHub Pages изначально был выключен;
- Render первоначально разрешал WebSocket Origin только со своего домена и отклонял GitHub Pages.

Полный исходный аудит и доказательства находятся в `AUDIT.md`.

## Что исправлено

- создан единый типизированный протокол `shared/protocol.ts` с runtime-валидацией;
- стабилизированы room lifecycle, reconnect grace, session resume, heartbeat, TTL, chat history и graceful shutdown;
- добавлены `/healthz`, `/readyz` и production `/ws`;
- реализованы perfect negotiation, ICE queue, ICE restart, стабильные sender roles и полный peer cleanup;
- media разделено на lifecycle микрофона, удалённого аудио и screen share;
- добавлены device selection, voice activity, speaking indicators и диагностика WebRTC;
- собран Tauri desktop-host с нативным Windows control runtime;
- добавлены drawing, synchronized local video, backend chat history и подтверждаемое remote control;
- добавлены production-конфигурации Render, Docker и GitHub Actions/Pages;
- исправлена Linux optional-dependency сборка Render и Pages;
- исправлен кроссплатформенный browser timer type;
- GitHub Pages включён и получил `VITE_SIGNALING_URL` и `VITE_PUBLIC_APP_URL`;
- Render `ALLOWED_ORIGINS` включает основной Render origin и `https://albertweskert.github.io`.

## Фактическая production-проверка

Проверено после публикации:

| Проверка | Результат |
|---|---|
| Render deploy | PASS, service `live` |
| `GET /healthz` | PASS, HTTP 200, version `0.2.0` |
| `GET /readyz` | PASS, HTTP 200, version `0.2.0` |
| основной HTML/JS/CSS | PASS, HTTP 200 |
| публичный WSS `ping` | PASS, получен `pong` |
| публичный WSS `create-room` | PASS, получен `room-created` |
| Render production Edge smoke | PASS |
| GitHub Pages workflow | PASS |
| GitHub Pages production Edge smoke | PASS |

Production Edge smoke выполнялся двумя независимыми browser contexts. Фактически подтверждены: создание комнаты, вход второго участника, два участника в комнате, live fake-microphone WebRTC track, live fake-screen video track, доставка чата обоим клиентам и отсутствие page errors.

Это не является проверкой качества реального микрофона/динамиков, наличия настоящего system audio или удалённого управления на двух физических Windows-компьютерах.

## Локальные и CI-проверки

| Проверка | Итог | Результат |
|---|---:|---|
| `npm run build` | PASS | backend + web production build |
| `npm run typecheck` | PASS | server + client |
| `npm run lint` | PASS | 0 warnings, 0 errors |
| `npm run test:unit` | PASS | 32 теста: 15 server + 17 client |
| `npm run test:integration` | PASS | 5/5 |
| `npm run test:e2e` | PASS | полный Edge flow |
| `npm audit --audit-level=high` | PASS | 0 vulnerabilities |
| `cargo fmt -- --check` | PASS | Rust formatting |
| `cargo check --locked` | PASS | Tauri/Rust build check |
| `cargo test --locked -j 1` | PASS | native test profile |
| `npm run desktop:package` | PASS | standalone exe + NSIS installer |
| desktop smoke-test | PASS | процесс приложения запускался и оставался активным |
| GitHub `Build and test` | PASS | Windows CI, включая desktop package |
| GitHub Pages deploy | PASS | опубликован artifact |
| Docker image build | NOT RUN | Docker CLI отсутствует на локальной машине |
| реальные устройства/TURN | NOT RUN | требуется физическое окружение и TURN account |

## Выполненные команды

Основные команды аудита, сборки и тестов:

```text
npm install
npm ci
npm run build
npm run build:server
npm run build:web
npm run typecheck
npm run lint
npm run test
npm run test:unit
npm run test:integration
npm run test:e2e
npm run diagnostics
npm audit --audit-level=high
cargo fetch --locked
cargo check --locked
cargo fmt
cargo fmt -- --check
cargo test --locked -j 1
npm run desktop:package
```

Production-проверки:

```text
curl https://watch-together-p2p-ghost.onrender.com/healthz
curl https://watch-together-p2p-ghost.onrender.com/readyz
node WebSocket ping/create-room smoke
node production two-client Edge smoke against Render
node production two-client Edge smoke against GitHub Pages
```

Render build command:

```text
npm ci && npm install --no-save --package-lock=false @rolldown/binding-linux-x64-gnu@1.1.5 && npm run build
```

## Изменённые и созданные файлы

Изменения затронули перечисленные ниже tracked project files, включая аудит, отчёт и bootstrap workflow.

Root, deployment и документация:

```text
.dockerignore
.env.example
.gitignore
ARCHITECTURE.md
AUDIT.md
CHANGELOG.md
DEPLOYMENT.md
Dockerfile
FINAL_REPORT.md
INSTRUKCIYA.md
MANUAL_TESTING.md
README.md
SECURITY.md
TESTING.md
eslint.config.mjs
package-lock.json
package.json
render.yaml
start-local-only.bat
start.bat
```

CI, E2E и scripts:

```text
.github/workflows/bootstrap.yml
.github/workflows/ci.yml
.github/workflows/deploy-pages.yml
e2e/browser-flow.test.mjs
scripts/dev.mjs
scripts/diagnostics.mjs
```

Shared и signaling-server:

```text
shared/protocol.ts
shared/types.ts
signaling-server/package.json
signaling-server/src/rooms.ts
signaling-server/src/server.ts
signaling-server/src/types.ts
signaling-server/test/protocol.test.ts
signaling-server/test/rooms.test.ts
signaling-server/test/server.integration.test.ts
signaling-server/tsconfig.json
```

Desktop/web client:

```text
desktop-client/package.json
desktop-client/src/App.tsx
desktop-client/src/components/ChatPanel.tsx
desktop-client/src/components/ControlPanel.tsx
desktop-client/src/components/DesktopSetup.tsx
desktop-client/src/components/DiagnosticsPanel.tsx
desktop-client/src/components/DrawingCanvas.tsx
desktop-client/src/components/MicrophoneControls.tsx
desktop-client/src/components/ParticipantList.tsx
desktop-client/src/components/QualitySelector.tsx
desktop-client/src/components/RemoteAudioSink.tsx
desktop-client/src/components/RemoteControlSurface.tsx
desktop-client/src/components/RoomHeader.tsx
desktop-client/src/components/RoomJoin.tsx
desktop-client/src/components/ScreenStage.tsx
desktop-client/src/components/SynchronizedVideo.tsx
desktop-client/src/lib/audioLevel.ts
desktop-client/src/lib/controlState.ts
desktop-client/src/lib/desktopControl.ts
desktop-client/src/lib/drawingState.ts
desktop-client/src/lib/imageUtils.ts
desktop-client/src/lib/mediaSync.ts
desktop-client/src/lib/peerManager.ts
desktop-client/src/lib/roomLink.ts
desktop-client/src/lib/runtimeConfig.ts
desktop-client/src/lib/signalingClient.ts
desktop-client/src/lib/webrtcState.ts
desktop-client/src/styles.css
desktop-client/src/vite-env.d.ts
desktop-client/test/audio-level.test.ts
desktop-client/test/control-state.test.ts
desktop-client/test/drawing-state.test.ts
desktop-client/test/media-sync.test.ts
desktop-client/test/room-link.test.ts
desktop-client/test/signaling-client.test.ts
desktop-client/test/webrtc-state.test.ts
```

Tauri/Rust и generated schemas:

```text
desktop-client/src-tauri/Cargo.lock
desktop-client/src-tauri/Cargo.toml
desktop-client/src-tauri/capabilities/default.json
desktop-client/src-tauri/gen/schemas/acl-manifests.json
desktop-client/src-tauri/gen/schemas/capabilities.json
desktop-client/src-tauri/gen/schemas/desktop-schema.json
desktop-client/src-tauri/gen/schemas/windows-schema.json
desktop-client/src-tauri/src/main.rs
desktop-client/src-tauri/tauri.conf.json
```

## Desktop artifacts

Standalone application:

```text
C:\Users\Ghost\Desktop\проєкт жизни\p2p-app\desktop-client\src-tauri\target\release\watch-together.exe
```

- размер: `8,820,736` bytes
- SHA-256: `FC5173EF59FC429D9D4B62C1760A649D88E094D83828605D383C8BC2875CFFA3`

NSIS installer:

```text
C:\Users\Ghost\Desktop\проєкт жизни\p2p-app\desktop-client\src-tauri\target\release\bundle\nsis\Watch Together_0.1.0_x64-setup.exe
```

- размер: `1,942,807` bytes
- SHA-256: `568F8074A7FA0AA46F417E7DBA951486828191096D8433DEEE7651C95BD6ED8A`

Текущий desktop release собран до подключения production URL. При первом запуске в Desktop Setup нужно указать:

```text
Signaling URL: wss://watch-together-p2p-ghost.onrender.com/ws
Public app URL: https://watch-together-p2p-ghost.onrender.com
```

## Что ещё требуется

Для уже опубликованной постоянной ссылки больше не требуется аккаунт хостинга или домен. Render и GitHub Pages подключены.

Для полного production-качества ещё требуется:

1. TURN provider или собственный coturn, его `turn:`/`turns:` URLs и shared secret — без этого соединение через restrictive NAT не гарантируется.
2. Ручная проверка на двух и более физических Windows-компьютерах: реальные микрофоны, динамики, system audio, повторный screen share, 3–4 участника и reconnect между разными сетями.
3. Ручная проверка Windows mouse/keyboard injection, revoke, emergency stop, multi-monitor и DPI.
4. При необходимости стабильного старта без cold start — платный Render instance; Free instance может засыпать при бездействии.
5. Для подписанного Windows installer — code-signing certificate.
6. Для собственного адреса — домен и DNS; текущие `onrender.com` и `github.io` ссылки уже постоянные.

## Ограничения подтверждения

Не заявляются как физически проверенные: качество реального голоса, реальный system audio, TURN relay, удалённое управление на двух компьютерах и качество работы из разных NAT/сетей. Они подготовлены в коде, но требуют сценариев из `MANUAL_TESTING.md` и соответствующего оборудования.
