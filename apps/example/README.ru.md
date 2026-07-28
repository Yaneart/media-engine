# Media Engine React example

[English](https://github.com/Yaneart/media-engine/blob/main/apps/example/README.md) | **Русский**

Небольшое приложение для проверки Media Engine в браузере: поиск, детали, выбор эпизода и доступные online player options. Player results группируются по эпизоду, семейству player, озвучке и качеству, но отдельные озвучки остаются выбираемыми.

## Запуск

Из корня репозитория:

```bash
pnpm install
pnpm dev:compose
```

Откройте <http://127.0.0.1:5173>.

Чтобы запустить только frontend:

```bash
pnpm --filter @media-engine/example dev
```

По умолчанию frontend ожидает API на `http://127.0.0.1:3000`. Измените `VITE_MEDIA_ENGINE_API_URL`, если API находится в другом месте.

Браузер использует `@media-engine/sdk`. Provider-код и серверная конфигурация остаются вне frontend.

## Проверка

```bash
pnpm --filter @media-engine/example typecheck
pnpm --filter @media-engine/example build
```

Это демонстрация, а не готовый киносайт. Сторонние плееры могут работать не в каждом браузере, стране или сети. Embed-плееры не загружаются автоматически: по умолчанию доступна внешняя ссылка, а встроенное воспроизведение требует явного нажатия и работает с ограниченной iframe-политикой, которая сохраняет origin стороннего плеера и передает в referrer только origin frontend-приложения. Некоторые хосты плееров отклоняют полностью referrerless-запросы.

Example не поставляет универсальный `frame-src` Content Security Policy, потому что player hosts динамические. Production deployment должен отключить embeds или задать CSP с явным allowlist под выбранных providers; external-link flow остается доступен, когда framing заблокирован.

## Лицензия

MIT
