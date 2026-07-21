# React-пример Media Engine

[English](https://github.com/Yaneart/media-engine/blob/main/apps/example/README.md) | **Русский**

Это небольшое приложение позволяет попробовать Media Engine в браузере: выполнить поиск, открыть детали, выбрать эпизод и посмотреть доступные варианты плееров.

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

Браузер использует `@media-engine/sdk`. Код провайдеров и серверные настройки не попадают во frontend.

## Проверки

```bash
pnpm --filter @media-engine/example typecheck
pnpm --filter @media-engine/example build
```

Это демонстрация, а не готовый киносайт. Сторонние плееры могут работать не в каждом браузере, стране или сети. Embed-плееры не загружаются автоматически: по умолчанию доступна внешняя ссылка, а встроенное воспроизведение требует явного нажатия и работает с ограниченной iframe-политикой, которая сохраняет origin стороннего плеера и не передаёт referrer.

Example не задаёт универсальную Content Security Policy `frame-src`, потому что адреса плееров динамические. В production следует отключить embed или задать CSP с явным allowlist выбранных провайдеров; внешняя ссылка остаётся доступной, даже если iframe заблокирован.

## Лицензия

MIT
