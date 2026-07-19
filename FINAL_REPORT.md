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

Production Windows-сборка создаётся job `desktop` в GitHub Actions с уже встроенными Render WSS и GitHub Pages URL. Готовые `.exe` и NSIS installer публикуются как artifact `watch-together-windows-production`.

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
| GitHub `Build and test` run `29688587384` | PASS, `5m 45s` |
| production Windows artifact | PASS, `watch-together-windows-production` |

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
| исходный локальный `npm run desktop:package` | PASS | standalone exe + NSIS installer |
| локальная повторная production-упаковка | FAIL (environment) | Rust `windows` crate исчерпал доступную память этого ПК; кодовый web-build до этого шага прошёл |
| production `npm run desktop:package` в GitHub CI | PASS | `.exe` + NSIS 0.2.0 с production endpoints |
| production desktop smoke-test | PASS | новый процесс приложения запускался и оставался активным после 5 секунд |
| GitHub `Build and test` | PASS | Windows CI: web/server `1m 24s`, desktop `5m 42s` |
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
$env:VITE_SIGNALING_URL='wss://watch-together-p2p-ghost.onrender.com/ws'
$env:VITE_PUBLIC_APP_URL='https://albertweskert.github.io/-/'
$env:CARGO_BUILD_JOBS='1'
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

- размер: `8,708,608` bytes
- SHA-256: `408813AC02FB10E33356BC8B25437B1BCF70770276F4AE731EC3CA6409238323`

NSIS installer:

```text
C:\Users\Ghost\Desktop\проєкт жизни\p2p-app\desktop-client\src-tauri\target\release\bundle\nsis\Watch Together_0.2.0_x64-setup.exe
```

- размер: `1,919,848` bytes
- SHA-256: `BA6B4BB7C80689490EDCA2D36CE08C2B4653C68447068EF3B8CE67E894ED387E`

Текущий desktop release собран GitHub Actions с готовыми production endpoints:

```text
Signaling URL: wss://watch-together-p2p-ghost.onrender.com/ws
Public app URL: https://albertweskert.github.io/-/
```

Artifact GitHub Actions: `watch-together-windows-production`, run `29688587384`, archive SHA-256 `9D45496554AADB610F11A92EA6968AD95EEFE8C829B9B501433BB108BC93D366`.

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

## Дополнение: production Tauri WebSocket Origin

Проверка 19 июля 2026 года установила production Origin Windows Tauri/WebView2: `http://tauri.localhost`. Старое значение Render `ALLOWED_ORIGINS` было:

```text
https://watch-together-p2p-ghost.onrender.com,https://albertweskert.github.io
```

Новое значение:

```text
https://watch-together-p2p-ghost.onrender.com,https://albertweskert.github.io,http://tauri.localhost
```

Причина отказа: сервер сравнивал заголовок `Origin` с allowlist точным совпадением и возвращал HTTP 403 на WebSocket upgrade до обработчика `connection`, потому что `http://tauri.localhost` отсутствовал в списке.

Серверная origin policy теперь нормализует список, разделённый запятыми, удаляет пробелы, сравнивает нормализованные URL origins и применяет одну policy к `/ws`. В production-логах остаются только структурированные поля `origin`, `path`, `reason` и `close code` без query string, токенов и приватных данных.

Фактическая production-проверка после Render deploy `dep-d9ee0us585fs73dunl70`:

- Render state: `live`, `allowedOriginCount: 3`;
- `http://tauri.localhost` → `upgrade-accepted`, path `/ws`;
- создание комнаты → PASS;
- `healthz` при desktop-origin host: `rooms: 1`, `connections: 1`;
- GitHub Pages вход по шестизначному коду → PASS;
- GitHub Pages вход по прямому invite URL → PASS;
- `healthz` после двух browser joins: `rooms: 1`, `connections: 3`.

Для GitHub Pages дополнительно исправлен разбор invite URL под project base path `/-/room/...`; добавлен regression test.

Сетевой smoke использовал тот же production WSS и точный заголовок Origin Tauri, но не заменяет интерактивную проверку кнопки Retry в окне WebView2. Скачанный production `watch-together.exe` был запущен из artifact, однако изолированная среда Codex не создала доступное интерактивное WebView2-окно; поэтому GUI Retry пока не отмечен как PASS.

Финальный GitHub Actions run: `29691433646` (`web-and-server` PASS, `desktop` PASS). Artifact `watch-together-windows-production`:

- archive SHA-256: `C38E448AE7A1840CC984416D4A4EF7DD028B15C43FC2FFE76569BB5C05D350AB`;
- `watch-together.exe` SHA-256: `69532E771504219BDA7617A039C8E75DEBB861C59DAC71FAA191F1EAB1A76390`;
- локально: `C:\Users\Ghost\Documents\Codex\2026-07-18\task-md-readme-md-instrukciya-md\final-production-artifact\watch-together.exe`.
