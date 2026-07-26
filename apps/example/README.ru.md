# React-пример Media Engine

[English](https://github.com/Yaneart/media-engine/blob/main/apps/example/README.md) | **Русский**

Это небольшое приложение позволяет попробовать Media Engine в браузере: выполнить поиск, открыть детали, выбрать эпизод, посмотреть доступные варианты плееров, явно запросить настроенные torrent-кандидаты и проверить опциональный reference torrent playback. Плееры группируются по эпизоду, семейству, переводу и качеству, но отдельные озвучки остаются доступны. Torrent observations группируются по info hash для отображения, при этом каждый provider source можно выбрать отдельно.

## Запуск

Из корня репозитория:

```bash
pnpm install
pnpm dev:compose
```

Откройте <http://127.0.0.1:5173>.

Запуск только frontend:

```bash
pnpm --filter @media-engine/example dev
```

По умолчанию приложение ожидает API на `http://127.0.0.1:3000`. Если API находится по другому адресу, измените `VITE_MEDIA_ENGINE_API_URL`.

По умолчанию torrent discovery выключен. Добавьте явный allowlist API в корневой `.env`, затем
перезапустите API/Compose:

```dotenv
MEDIA_ENGINE_TORRENT_PROVIDERS=yts-torrent,jacred-torrent,bitsearch-torrent,magnetz-torrent
```

Панель Details не отправляет torrent-запрос до нажатия **Find torrent candidates**. В ней можно
выбрать общий релиз, season/episode или абсолютный эпизод аниме, переключить observations одного
hash, скопировать magnet handoff, открыть страницу источника и запустить включённую reference
playback session. BitTorrent-клиент не запускается в браузере: API передаёт transport отдельно
работающему процессу TorServer.

Для reference playback также нужны парные server-side настройки из корневого `.env.example` и
явный Compose profile:

```dotenv
MEDIA_ENGINE_TORRSERVER_URL=http://torrserver:8090
MEDIA_ENGINE_TORRENT_PLAYBACK_TOKEN=<не-менее-32-случайных-символов>
MEDIA_ENGINE_TORRENT_PLAYBACK_MEDIA_WORKER_URL=http://torrent-media-worker:8080
```

```bash
docker compose --profile torrent-playback up --build
```

Vite dev/preview server работает как узкий same-origin lifecycle BFF. Он добавляет операторский
Bearer token только на сервере и возвращает браузеру только snapshot сессии; token не получает
префикс `VITE_`, не попадает в bundle/storage и не отправляется в браузер. Нативный `<video>`
получает только временный capability `streamUrl`. Статический production deployment должен
предоставить эквивалентные аутентифицированные BFF routes либо оставить reference player выключенным.

Браузер использует `@media-engine/sdk`. Код провайдеров и серверные настройки не попадают во frontend.

## Проверки

```bash
pnpm --filter @media-engine/example typecheck
pnpm --filter @media-engine/example build
```

Это демонстрация, а не готовый киносайт. Сторонние плееры и страницы torrent-источников могут работать не в каждом браузере, стране или сети. Для прямых HLS-вариантов используется нативное воспроизведение браузера, а при его отсутствии лениво загружается `hls.js`. Torrent-файлы с browser-compatible дорожками в неподходящем container асинхронно remux-ятся без перекодирования видео и затем подключаются через ту же приватную capability. Файлы со статусом `conversion_required` всё ещё требуют transcode, поэтому честно отображаются без подключения к `<video>`. Embed-плееры не загружаются автоматически: по умолчанию доступна внешняя ссылка, а встроенное воспроизведение требует явного нажатия и работает с ограниченной iframe-политикой, которая сохраняет origin стороннего плеера и передаёт в referrer только origin frontend-приложения. Некоторые хосты плееров отклоняют полностью referrerless-запросы.

Example не задаёт универсальную Content Security Policy `frame-src`, потому что адреса плееров динамические. В production следует отключить embed или задать CSP с явным allowlist выбранных провайдеров; внешняя ссылка остаётся доступной, даже если iframe заблокирован.

## Лицензия

MIT
