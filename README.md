# Watch Together

Windows desktop-host и постоянный web-клиент для P2P-звонка, демонстрации экрана, чата, рисования и подтверждаемого удалённого управления.

## Возможности

- комнаты до 4 участников, вход по коду или ссылке `/room/ROOM_ID?invite=...`;
- P2P WebRTC mesh: микрофон, screen video и system audio, если источник его предоставил;
- perfect negotiation, очередь ICE, ICE restart и восстановление signaling-сессии;
- временные TURN credentials от backend;
- история чата, изображения, TTL и восстановление после reconnect;
- drawing overlay в нормализованных координатах;
- синхронное воспроизведение одинакового локального видеофайла;
- Tauri desktop-host с нативными control sessions для выбранного монитора;
- диагностика RTT, loss, bitrate, resolution/FPS и direct/relay;
- Windows `.exe` и NSIS installer.

## Быстрый локальный запуск

Требуется Node.js 22+.

```powershell
npm ci
npm run build
npm run dev:server
```

Откройте `http://localhost:8787`. Для параллельной разработки frontend/backend используйте `npm run dev`.

## Команды

```text
npm run build             server + web production build
npm run typecheck         TypeScript без emit
npm run lint              ESLint
npm test                  unit + integration
npm run test:e2e          build + Edge browser E2E
npm run diagnostics       проверка окружения и конфигурации
npm run desktop:dev       Tauri development
npm run desktop:build     release .exe без installer
npm run desktop:package   release .exe + NSIS installer
```

Для desktop build нужны Rust stable, MSVC Build Tools и WebView2. Production desktop получает `VITE_SIGNALING_URL` и `VITE_PUBLIC_APP_URL` во время сборки либо предлагает ввести их при первом запуске.

## Структура

```text
desktop-client/       React web-client и Tauri desktop-host
signaling-server/     HTTP, WebSocket signaling, rooms, chat history, TURN issuance
shared/               единый protocol и общие типы
e2e/                  Edge browser E2E
scripts/              dev orchestration и diagnostics
```

Подробнее: [ARCHITECTURE.md](./ARCHITECTURE.md), [DEPLOYMENT.md](./DEPLOYMENT.md), [TESTING.md](./TESTING.md), [SECURITY.md](./SECURITY.md).

## Проверенные ограничения

- Автоматический Edge E2E проверяет фактические browser WebRTC tracks с fake media, но не качество реальных микрофонов/динамиков и не наличие реального system audio.
- Нативный Windows control runtime компилируется и покрыт проверками протокола; реальное управление с двух физических компьютеров ещё требует ручной проверки.
- P2P mesh ограничен четырьмя участниками. Для больших комнат потребуется SFU.
- Постоянная публичная ссылка появляется только после deployment на постоянный HTTPS-домен.
