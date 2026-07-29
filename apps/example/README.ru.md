# Media Engine React example

[English](https://github.com/Yaneart/media-engine/blob/main/apps/example/README.md) | **Русский**

Небольшое приложение для проверки Media Engine в браузере: поиск, детали, выбор эпизода, доступные online player options, поиск torrent-релизов, выбор любого обычного файла и воспроизведение его защищённого original stream в одном нативном `<video>`.

## Запуск

Из корня репозитория:

```bash
pnpm install
# Сначала задайте в .env случайный server token длиной от 32 символов:
# MEDIA_ENGINE_ORIGINAL_TORRENT_TOKEN=...
docker compose up -d
```

Откройте <http://127.0.0.1:5173>.

Чтобы запустить только frontend:

```bash
pnpm --filter @media-engine/example dev
```

По умолчанию frontend ожидает API на `http://127.0.0.1:3000`. Измените `VITE_MEDIA_ENGINE_API_URL`, если API находится в другом месте.

Браузер использует `@media-engine/sdk` для public discovery. Вызовы create/status/select/stop torrent-session проходят через same-origin server-side BFF, который добавляет `MEDIA_ENGINE_ORIGINAL_TORRENT_TOKEN`; token не раскрывается через переменную с префиксом `VITE_` и не попадает в browser bundle. Вне Compose example server обращается к API по `MEDIA_ENGINE_ORIGINAL_TORRENT_API_URL`, по умолчанию `http://127.0.0.1:3000`.

Torrent player стримит точные выбранные bytes без фильтрации расширений, probing, conversion или fallback. `waiting_metadata` означает ожидание torrent metadata; `Buffering first pieces` означает, что capability уже готова, но браузер ждёт stream bytes. Исправный stream всё равно может завершиться как `client_format_unsupported`, если браузер не декодирует исходный container или codecs.

## Проверка

```bash
pnpm --filter @media-engine/example typecheck
pnpm --filter @media-engine/example test:unit
pnpm --filter @media-engine/example build
```

Это демонстрация, а не готовый киносайт. Сторонние плееры и публичные torrent swarms могут работать не в каждом браузере, стране или сети. Embed-плееры не загружаются автоматически: по умолчанию доступна внешняя ссылка, а встроенное воспроизведение требует явного нажатия и работает с ограниченной iframe-политикой, которая сохраняет origin стороннего плеера и передает в referrer только origin frontend-приложения. Некоторые хосты плееров отклоняют полностью referrerless-запросы.

Example не поставляет универсальный `frame-src` Content Security Policy, потому что player hosts динамические. Production deployment должен отключить embeds или задать CSP с явным allowlist под выбранных providers; external-link flow остается доступен, когда framing заблокирован.

## Лицензия

MIT
