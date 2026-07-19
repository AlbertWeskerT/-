# Инструкция пользователя

## Локальная проверка

1. Установите Node.js 22+.
2. В корне проекта выполните `npm ci`, затем `npm run build`.
3. Выполните `npm run dev:server`.
4. Откройте `http://localhost:8787` в Chrome или Edge.

Можно использовать `start.bat`: он установит зависимости, соберёт проект, запустит server и откроет локальную страницу.

## Desktop-host

Готовый installer находится в `desktop-client/src-tauri/target/release/bundle/nsis/`. Хост устанавливает его, запускает Watch Together и один раз вводит production WSS/HTTPS адреса, если они не были встроены при сборке.

## Сеанс

1. Хост создаёт комнату и копирует HTTPS-ссылку из верхней панели.
2. Гость открывает ссылку в Chrome/Edge, вводит nickname и нажимает `Join room`.
3. Каждый участник отдельно включает microphone.
4. Хост нажимает `Share screen` и в системном окне выбирает источник. Статус сообщает, был ли предоставлен system audio.
5. Для рисования нажмите `Draw`.
6. Для локального видео хост выбирает `Synchronized video`; каждый участник выбирает свою копию того же файла.

## Удалённое управление

1. Хост должен использовать Windows desktop-приложение и делиться полным монитором.
2. Хост выбирает в панели тот же monitor и включает preset `Support Lite` или `Full Control`.
3. Гость нажимает `Request mouse` или `Request mouse + keyboard`.
4. Хост явно разрешает или отклоняет запрос.
5. Остановить сессию можно кнопкой `Stop control` или `Ctrl+Shift+F12` на host.

## Если что-то не работает

- `signaling unavailable`: проверьте WSS URL и доступность `/healthz`.
- `TURN unavailable`: backend запущен без `TURN_URLS`/`TURN_SHARED_SECRET`.
- microphone denied: разрешите микрофон для сайта/приложения и повторите `Unmute`.
- system audio not provided: выберите источник, который поддерживает передачу звука, и включите соответствующий пункт в системном picker.
- autoplay blocked: нажмите появившуюся кнопку включения звука.
- control недоступен: используйте desktop-host, full monitor sharing и разрешающий preset.

Production deployment описан в [DEPLOYMENT.md](./DEPLOYMENT.md), полный ручной checklist — в [MANUAL_TESTING.md](./MANUAL_TESTING.md).
