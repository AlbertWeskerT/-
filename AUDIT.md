# Watch Together — исходный аудит

Дата аудита: 18 июля 2026 г.  
Состояние: аудит выполнен до внесения исправлений.

## Объём проверки

Полностью прочитаны `TASK.md`, `README.md`, `INSTRUKCIYA.md`, исходники и конфигурация в `desktop-client`, `signaling-server`, `shared`, `.github`, Tauri/Rust, BAT-файлы и deployment-конфигурация. Проверены установленные зависимости, TypeScript/Vite build, server build, Tauri build, реальный HTTP/SPA запуск, WebSocket relay test и npm audit.

Физические проверки звука, системного звука, screen sharing, DPI/multi-monitor и реального ввода мыши/клавиатуры на двух компьютерах на этом этапе не выполнялись. Наличие кода или WebRTC-трека не считается подтверждением этих сценариев.

## Исходные результаты команд

| Проверка | Результат до исправлений |
|---|---|
| `desktop-client: npm.cmd run build` | **FAIL** — TS2353: `latency` отсутствует в `MediaTrackConstraints` |
| `signaling-server: npm.cmd run build` | **PASS** |
| `signaling-server: node dist/server.js` | **PASS** — HTTP и WebSocket слушают порт |
| HTTP `/` и SPA fallback | **PASS** для существующего, ранее собранного `dist` |
| `signaling-server: node test-client.mjs` | **PASS**, но тест не проверяет WebRTC и может не падать при `console.assert` |
| `desktop-client: npm.cmd run tauri -- build` | **FAIL** — останавливается на том же frontend TypeScript error |
| `npm.cmd audit --json` в обоих пакетах | **PASS** — 0 известных advisory на момент проверки |
| lint / unit / integration / E2E | **NOT AVAILABLE** — соответствующих scripts/config/tests нет |

## Найденные проблемы

### AUD-001 — signaling server удалённо падает от JSON `null`

- **Серьёзность:** Critical.
- **Описание:** любой подключившийся WebSocket-клиент может завершить весь Node.js-процесс одним валидным JSON-сообщением `null`.
- **Причина:** результат `JSON.parse` сразу используется как `msg.type`; runtime schema/type guard отсутствует.
- **Файлы:** `signaling-server/src/server.ts`, `signaling-server/src/types.ts`.
- **Воспроизведение:** запустить `node dist/server.js`, подключиться к `/ws`, отправить строку `null`. Получен `TypeError: Cannot read properties of null (reading 'type')`, exit code 1.
- **План исправления:** валидировать envelope и payload до dispatch, безопасно отклонять unknown/malformed сообщения, добавить regression integration test.

### AUD-002 — протокол доверяет непроверенным payload

- **Серьёзность:** High.
- **Описание:** отсутствует runtime-проверка nickname, room code, preset, quality, SDP и ICE candidate. Допустимы пропущенные поля, неверные enum, `NaN`-подобные значения после преобразований и чрезмерно длинные строки.
- **Причина:** TypeScript-типы не существуют во время выполнения; сервер делает type assertion после `JSON.parse`.
- **Файлы:** `shared/types.ts`, `signaling-server/src/types.ts`, `signaling-server/src/server.ts`, `desktop-client/src/lib/signalingClient.ts`, `desktop-client/src/lib/peerManager.ts`.
- **Воспроизведение:** отправить `{"type":"create-room"}` или `{"type":"set-active-quality","quality":null}`; сообщение не отклоняется схемой.
- **План исправления:** единый shared protocol с исчерпывающими type guards/schema validation, нормализация строк, коды ошибок и негативные тесты для каждого message type.

### AUD-003 — нет лимита payload и rate limiting

- **Серьёзность:** High.
- **Описание:** сервер принимает крупные WebSocket-сообщения (до большого default `ws` limit), а клиент принимает неограниченные data-channel JSON/image payload. Один участник может исчерпать память/CPU.
- **Причина:** не заданы `maxPayload`, message-size limits, per-connection rate limits и backpressure policy.
- **Файлы:** `signaling-server/src/server.ts`, `desktop-client/src/lib/peerManager.ts`, `desktop-client/src/components/ChatPanel.tsx`.
- **Воспроизведение:** отправлять большие JSON/SDP/data URL или частый поток сообщений; ограничение приложения отсутствует.
- **План исправления:** серверные byte limits и token bucket, лимиты по типам, data-channel bufferedAmount guard, проверка размера до parse/render.

### AUD-004 — уход хоста оставляет гостей в «зомби-комнате»

- **Серьёзность:** High.
- **Описание:** `leaveRoom` удаляет комнату до broadcast. Последующий `broadcastToRoom` уже не находит комнату, поэтому гости не получают `host-ended`/`room-closed`, их connection state и participant socket mappings остаются активными.
- **Причина:** registry возвращает только `room: null`, теряя список получателей, и protocol не имеет события завершения комнаты.
- **Файлы:** `signaling-server/src/rooms.ts`, `signaling-server/src/server.ts`, `shared/types.ts`, `desktop-client/src/App.tsx`.
- **Воспроизведение:** создать комнату, присоединить гостя, закрыть socket хоста. Гость не получает явного завершения комнаты.
- **План исправления:** атомарный close result со списком участников, broadcast до удаления mappings, `room-closed/host-ended`, полная очистка state и integration test.

### AUD-005 — reconnect signaling отсутствует

- **Серьёзность:** High.
- **Описание:** при закрытии WebSocket клиент не показывает disconnect, не переподключается и не восстанавливает членство. Host refresh немедленно уничтожает комнату.
- **Причина:** `SignalingClient` не имеет `onclose`, reconnect state, session token, backoff или resume protocol.
- **Файлы:** `desktop-client/src/lib/signalingClient.ts`, `desktop-client/src/App.tsx`, `signaling-server/src/server.ts`, `signaling-server/src/rooms.ts`.
- **Воспроизведение:** разорвать signaling socket или обновить страницу после входа.
- **План исправления:** resumable session token, grace period, bounded exponential backoff, single-flight reconnect, UI statuses и tests.

### AUD-006 — heartbeat односторонний и не обнаруживает мёртвые клиенты

- **Серьёзность:** Medium.
- **Описание:** клиент посылает application `ping`, но сервер не использует WebSocket ping/pong для termination зависших TCP-соединений; после client socket close heartbeat продолжает ставить `ping` в неограниченную queue.
- **Причина:** нет server liveness sweep и `SignalingClient.onclose` cleanup.
- **Файлы:** `desktop-client/src/lib/signalingClient.ts`, `signaling-server/src/server.ts`.
- **Воспроизведение:** оборвать сеть без корректного close и наблюдать отсутствие server cleanup до TCP timeout; на клиенте `send` копит queue.
- **План исправления:** protocol/server heartbeat timestamps, native WS ping/pong, terminate stale socket, clear timer and bounded queue on close.

### AUD-007 — Perfect Negotiation реализован неполностью

- **Серьёзность:** High.
- **Описание:** нет `isSettingRemoteAnswerPending`, сериализации signal operations и явной/совместимой rollback-логики. Одновременные offer/answer/negotiation events могут выполняться параллельно.
- **Причина:** async listener вызывается через `forEach` без await/queue; реализация содержит только `makingOffer`, `ignoreOffer`, `polite`.
- **Файлы:** `desktop-client/src/lib/peerManager.ts`, `desktop-client/src/lib/signalingClient.ts`.
- **Воспроизведение:** одновременно добавить треки на обоих peers или быстро повторять renegotiation; unit harness для collision показывает отсутствие требуемого pending-answer state.
- **План исправления:** отдельный `PeerState`, последовательная signal queue, полный MDN perfect-negotiation algorithm и collision tests.

### AUD-008 — ICE-кандидаты теряются до remote description

- **Серьёзность:** High.
- **Описание:** кандидат немедленно передаётся в `addIceCandidate`; если description ещё не установлено, ошибка только логируется и кандидат безвозвратно теряется.
- **Причина:** per-peer ICE queue отсутствует.
- **Файлы:** `desktop-client/src/lib/peerManager.ts`.
- **Воспроизведение:** доставить `ice-candidate` раньше соответствующего offer/answer.
- **План исправления:** очередь кандидатов по peer/negotiation generation, flush после remote description, очистка ignored-offer candidates и unit tests.

### AUD-009 — repeated screen share создаёт новые senders/transceivers

- **Серьёзность:** High.
- **Описание:** при stop вызывается `removeTrack`; sender теряет track. Следующий start ищет sender по `sender.track?.kind`, не находит прежний sender и делает новый `addTrack`. Повторения накапливают transceivers/m-lines. Аналогичный риск есть при повторной установке mic stream.
- **Причина:** senders не хранятся по логической роли (`microphone`, `screen-video`, `screen-audio`).
- **Файлы:** `desktop-client/src/lib/peerManager.ts`.
- **Воспроизведение:** несколько раз start/stop screen share и проверить рост `pc.getSenders()/getTransceivers()`.
- **План исправления:** стабильные role-based sender slots/transceivers и `replaceTrack(track|null)` без дубликатов; tests.

### AUD-010 — ICE restart неограничен и не восстанавливает peer полностью

- **Серьёзность:** High.
- **Описание:** throttling 5 секунд не является лимитом попыток; нет grace period для `disconnected`, single-flight, backoff, recreation конкретного PC или terminal state.
- **Причина:** в negotiation state хранится только timestamp последней попытки.
- **Файлы:** `desktop-client/src/lib/peerManager.ts`.
- **Воспроизведение:** повторяющиеся transitions в `failed` при недоступном TURN/signaling.
- **План исправления:** bounded reconnect controller с attempt count/backoff/jitter, ICE restart, затем controlled peer recreation и cleanup.

### AUD-011 — гости не слышат других гостей в комнате 3+

- **Серьёзность:** High.
- **Описание:** отдельные `RemoteAudioSink` рендерятся только у хоста. Guest воспроизводит только stream хоста через `ScreenStage`, поэтому audio streams других гостей остаются непроигранными.
- **Причина:** UI playback policy привязана к роли хоста, хотя WebRTC mesh создаёт peer stream для каждого участника.
- **Файлы:** `desktop-client/src/App.tsx`, `desktop-client/src/components/RemoteAudioSink.tsx`, `desktop-client/src/components/ScreenStage.tsx`.
- **Воспроизведение:** три участника; два гостя включают mic, один guest не имеет audio element для второго guest.
- **План исправления:** один стабильный audio sink на каждый remote peer с исключением только уже воспроизводимых host tracks; multi-peer E2E/manual tests.

### AUD-012 — завершившийся микрофон нельзя корректно выбрать снова

- **Серьёзность:** High.
- **Описание:** `ended` выставляет UI off, но не очищает `micStreamRef`. Следующий click только меняет `enabled` у уже ended track и показывает ложное включение.
- **Причина:** media lifecycle state не синхронизирован с track.readyState; отсутствует device selection/replaceTrack.
- **Файлы:** `desktop-client/src/App.tsx`, `desktop-client/src/lib/peerManager.ts`.
- **Воспроизведение:** отключить активный USB-микрофон, затем нажать Unmute.
- **План исправления:** единый MediaManager, cleanup ended stream, повторный acquire, sender `replaceTrack`, devicechange handling и permission/device UI.

### AUD-013 — screen/system-audio cleanup и состояние неполны

- **Серьёзность:** High.
- **Описание:** при `videoTrack.onended` screen audio reference обнуляется без гарантированного `stop`; capability наличия системного звука не показывается. Ошибка `applyConstraints` скрывается, хотя UI продолжает показывать выбранное качество.
- **Причина:** разрозненные refs/callbacks, отсутствие единой capture session и verified state.
- **Файлы:** `desktop-client/src/App.tsx`, `desktop-client/src/lib/peerManager.ts`, `desktop-client/src/components/QualitySelector.tsx`.
- **Воспроизведение:** завершить share из системного picker или выбрать source без audio; UI не различает фактический результат.
- **План исправления:** атомарная capture session cleanup, фактические track indicators, surfaced errors и manual Windows/WebView2 matrix.

### AUD-014 — frontend production build сломан

- **Серьёзность:** High.
- **Описание:** TypeScript strict build не проходит, из-за чего невозможно получить актуальный web dist и Tauri package.
- **Причина:** `latency` указан в audio constraints, но отсутствует в используемом DOM `MediaTrackConstraints` type.
- **Файлы:** `desktop-client/src/App.tsx`.
- **Воспроизведение:** `npm.cmd run build`.
- **План исправления:** удалить неподдерживаемый constraint либо корректно feature-detect через стандартные constraints без подавления TypeScript.

### AUD-015 — ошибки скрываются через `any` и пустые catch

- **Серьёзность:** Medium.
- **Описание:** используются `(import.meta as any)`, `(report: any)`, пустые catch для stats/constraints/fullscreen, что нарушает требования TASK и создаёт fake-success UI.
- **Причина:** отсутствуют `ImportMetaEnv` declarations, typed RTC stats parser и error reporting strategy.
- **Файлы:** `desktop-client/src/App.tsx`, `desktop-client/src/lib/peerManager.ts`, `desktop-client/src/components/ScreenStage.tsx`.
- **Воспроизведение:** поиск `any`, `catch {}`; принудительно отклонить `applyConstraints`.
- **План исправления:** строгие declarations/unknown guards, structured diagnostics, безопасные user-visible failures.

### AUD-016 — chat identity и payload можно подменить

- **Серьёзность:** High.
- **Описание:** nickname берётся из P2P chat payload, а не из participant state, поэтому peer может показываться под чужим именем. Нет message ID, dedupe, history, TTL и validation.
- **Причина:** data-channel message доверяется после небезопасного `JSON.parse`.
- **Файлы:** `desktop-client/src/lib/peerManager.ts`, `desktop-client/src/components/ChatPanel.tsx`, `desktop-client/src/App.tsx`.
- **Воспроизведение:** отправить вручную `{kind:"chat",nickname:"Host",...}` с guest channel.
- **План исправления:** автор определяется по bound participantId, schema/limits/message ID/dedupe, bounded backend history/recovery.

### AUD-017 — изображения не валидируются на приёме

- **Серьёзность:** High.
- **Описание:** честный клиент перекодирует local file в JPEG, но принимающая сторона доверяет произвольному `imageDataUrl`; нет MIME/signature/size validation и ограничения внешних URL.
- **Причина:** проверка выполняется только до отправки в UI одного клиента.
- **Файлы:** `desktop-client/src/lib/imageUtils.ts`, `desktop-client/src/lib/peerManager.ts`, `desktop-client/src/components/ChatPanel.tsx`.
- **Воспроизведение:** malicious peer отправляет огромную или не-image строку в `imageDataUrl`.
- **План исправления:** schema, byte/MIME magic validation, только разрешённые generated data/blob URLs, object URL cleanup и tests.

### AUD-018 — production room URL/invite flow отсутствует

- **Серьёзность:** High.
- **Описание:** приложение поддерживает только ручной шестизначный code. Нет `/room/ROOM_ID`, invite token, copy link, room existence/closed page или URL join after refresh.
- **Причина:** router/invite protocol не реализованы.
- **Файлы:** `desktop-client/src/App.tsx`, `desktop-client/src/components/RoomJoin.tsx`, `desktop-client/src/components/RoomHeader.tsx`, server/shared protocol.
- **Воспроизведение:** открыть `/room/...`; SPA показывает обычный host/join form и не использует URL.
- **План исправления:** crypto room/invite identifiers, URL parser/router, copy button, join/closed states и deployment rewrites.

### AUD-019 — Tauri production host не настроен

- **Серьёзность:** Critical capability gap.
- **Описание:** Tauri wrapper не имеет production signaling URL, native screen/control APIs, settings, lifecycle hooks или emergency hotkey. В packaged app default URL вычисляется из внутреннего origin и не указывает на удалённый backend.
- **Причина:** `src-tauri` является минимальным Phase 1 shell.
- **Файлы:** `desktop-client/src-tauri/*`, `desktop-client/src/App.tsx`, `desktop-client/vite.config.ts`.
- **Воспроизведение:** проверить production config/main.rs; custom commands отсутствуют, `VITE_SIGNALING_URL` не обязателен.
- **План исправления:** production/dev config validation, Tauri lifecycle/settings, native capture/control boundary, secure capabilities/CSP и packaging commands.

### AUD-020 — CSP отключён и origin validation отсутствует

- **Серьёзность:** High.
- **Описание:** Tauri `csp` равен `null`; WebSocket server принимает любой Origin; static server не ставит security headers.
- **Причина:** development/demo конфигурация используется как production.
- **Файлы:** `desktop-client/src-tauri/tauri.conf.json`, `signaling-server/src/server.ts`, `render.yaml`.
- **Воспроизведение:** подключиться к `/ws` с произвольным Origin; connection принимается.
- **План исправления:** allowlist origins, environment validation, CSP/connect-src, secure headers, reverse-proxy docs/tests.

### AUD-021 — долгоживущие TURN credentials попадают в public bundle

- **Серьёзность:** High.
- **Описание:** `VITE_TURN_USERNAME` и `VITE_TURN_CREDENTIAL` компилируются в публичный JavaScript bundle.
- **Причина:** TURN конфигурация читается напрямую из Vite env клиента.
- **Файлы:** `desktop-client/src/lib/peerManager.ts`, README/INSTRUKCIYA deployment guidance.
- **Воспроизведение:** собрать с этими env и найти credential в `dist/assets/*.js`.
- **План исправления:** backend endpoint для краткоживущих TURN credentials; не логировать/не хранить server secret в frontend.

### AUD-022 — room IDs/TTL/participant limits недостаточны

- **Серьёзность:** High.
- **Описание:** UUID room id криптографичен, но публично используется короткий code из `Math.random`; нет invite token, TTL, max rooms, max 4 participants policy, duplicate nickname rules или cleanup scheduler.
- **Причина:** in-memory MVP registry без operational limits.
- **Файлы:** `signaling-server/src/rooms.ts`.
- **Воспроизведение:** массово создавать комнаты/присоединять участников; registry растёт до disconnect/process restart.
- **План исправления:** `crypto.randomInt/randomBytes`, invite token hash, TTL sweep, capacity limits и tests.

### AUD-023 — health endpoint и graceful shutdown отсутствуют

- **Серьёзность:** High.
- **Описание:** Render проверяет `/`, который может вернуть frontend или instructional text независимо от readiness; `/health` не реализован. SIGTERM не закрывает комнаты/sockets/server с deadline.
- **Причина:** HTTP handler всегда вызывает static serving; shutdown hooks отсутствуют.
- **Файлы:** `signaling-server/src/server.ts`, `render.yaml`.
- **Воспроизведение:** запросить `/health`; получается SPA fallback вместо structured health. Отправить SIGTERM — custom drain отсутствует.
- **План исправления:** `/healthz`/`/readyz`, structured response, graceful WS close and HTTP drain, Render config update.

### AUD-024 — test suite не соответствует заявленной надёжности

- **Серьёзность:** High.
- **Описание:** нет unit/E2E runner и scripts. Единственный `test-client.mjs` проверяет фальшивый SDP relay; `console.assert` лишь печатает ошибку и может завершиться code 0.
- **Причина:** тестирование Phase 1 ограничено ручным скриптом.
- **Файлы:** оба `package.json`, `signaling-server/test-client.mjs`, отсутствующие test configs.
- **Воспроизведение:** `npm.cmd run test`, `lint` или `typecheck` — script missing.
- **План исправления:** root workspace scripts, unit/integration/E2E suites, настоящие assertions/timeouts/process exit и CI.

### AUD-025 — единый shared protocol фактически дублируется

- **Серьёзность:** Medium.
- **Описание:** server types «зеркалят» `shared/types.ts` вручную, что позволяет schema/type drift.
- **Причина:** signaling-server `rootDir` и package layout не импортируют shared package.
- **Файлы:** `shared/types.ts`, `signaling-server/src/types.ts`, `signaling-server/tsconfig.json`.
- **Воспроизведение:** сравнить protocol unions в двух файлах; синхронизация не автоматизирована.
- **План исправления:** один protocol module/package, используемый client/server/tests, без косметического массового перемещения.

### AUD-026 — root build/lint/typecheck/package commands отсутствуют

- **Серьёзность:** Medium.
- **Описание:** нет root `package.json` и требуемых TASK scripts (`build`, `test:*`, `desktop:*`, `diagnostics`).
- **Причина:** два независимых npm package без orchestration.
- **Файлы:** корень проекта, package manifests.
- **Воспроизведение:** выполнить требуемые команды из корня — package manifest отсутствует.
- **План исправления:** npm workspaces/root scripts с Windows-safe commands.

### AUD-027 — UI/resource state очищается не полностью

- **Серьёзность:** Medium.
- **Описание:** leave не очищает `connectionStates`, `networkStats` и error; host preview создаёт новый `MediaStream` на каждый render; remote ended track удаляется, но UI callback не вызывается после удаления.
- **Причина:** teardown закрывает низкоуровневые ресурсы, но не имеет полной session-state reset модели.
- **Файлы:** `desktop-client/src/App.tsx`, `desktop-client/src/lib/peerManager.ts`.
- **Воспроизведение:** войти/выйти/снова войти, менять stats/track state; наблюдать stale state/repeated srcObject changes.
- **План исправления:** idempotent session cleanup, stable preview stream и explicit remote-stream update/removal events.

### AUD-028 — remote control отсутствует и preset создаёт ложное ожидание

- **Серьёзность:** Critical capability gap.
- **Описание:** protocol содержит незащищённые заготовки control messages, но host callback пуст, Rust injection отсутствует, approval/session/sequence/nonce/expiry/emergency stop отсутствуют. Preset UI показывает `Full Control`, хотя функция не работает.
- **Причина:** Phase 2 не реализована.
- **Файлы:** `shared/types.ts`, `desktop-client/src/lib/peerManager.ts`, `desktop-client/src/App.tsx`, `desktop-client/src-tauri/src/main.rs`, UI.
- **Воспроизведение:** выбрать Full Control — OS input не выполняется и approval UI отсутствует.
- **План исправления:** сначала secure signaling authorization/session state, затем visible host approval, one-controller rule, native validation/injection, global emergency stop, stuck-key cleanup и physical manual test. До готовности UI должен честно маркировать функцию недоступной.

### AUD-029 — drawing, speaking indicator и synced playback отсутствуют

- **Серьёзность:** Medium capability gaps.
- **Описание:** нет overlay, normalized coordinate/batching protocol, voice activity analysis или separate local-file sync mode.
- **Причина:** функции из поздних этапов TASK не реализованы.
- **Файлы:** отсутствующие modules/UI/protocol/tests.
- **Воспроизведение:** соответствующих controls и message types нет.
- **План исправления:** добавлять только после стабилизации signaling/WebRTC/media/reconnect/tests, в порядке TASK.

### AUD-030 — документация противоречит коду и production-целям

- **Серьёзность:** Medium.
- **Описание:** README одновременно заявляет automatic ICE restart и «No reconnect logic»; описывает Phase 1 как tested end-to-end, хотя media не проверялась. INSTRUKCIYA рекомендует localhost/loca.lt и предварительно включать media, что не соответствует production TASK и маскирует order-dependent риски.
- **Причина:** документация обновлялась раундами без единой verification matrix.
- **Файлы:** `README.md`, `INSTRUKCIYA.md`.
- **Воспроизведение:** сопоставить claims с исходниками и исходными командами.
- **План исправления:** обновлять документы после проверок, разделить dev/production/manual verification и явно отмечать непроверенные physical scenarios.

## Архитектурный вывод

Текущую архитектуру можно стабилизировать без немедленной полной переписи: сохранить React/Tauri, Node.js/`ws`, shared TypeScript и P2P mesh, но выделить единый protocol validation layer, server room/session lifecycle, per-peer WebRTC state, media sender manager и bounded reconnect controller. Новые крупные функции (drawing/control/synced playback) нельзя безопасно накладывать до завершения этих базовых исправлений.

## Порядок исправлений после аудита

1. Единый signaling protocol, runtime validation, limits и regression tests.
2. Backend room lifecycle, authorization, heartbeat/reconnect foundation, health/shutdown.
3. Per-peer Perfect Negotiation, ICE queue, stable sender slots, bounded recovery.
4. Mic/remote audio/screen capture lifecycle и truthful UI.
5. Reconnect/resource cleanup и тесты существующих функций.
6. Production Tauri host, permanent URL/deployment/TURN.
7. Multi-user/speaking/drawing.
8. Secure remote control.
9. Chat history/synced playback/UI/diagnostics/docs/final build.
