# Media Engine React example

**English** | [Русский](https://github.com/Yaneart/media-engine/blob/main/apps/example/README.ru.md)

This small app lets you try Media Engine in a browser. It can search, open details, choose an episode, and show available player options.

## Run it

From the repository root:

```bash
pnpm install
pnpm dev:compose
```

Open <http://127.0.0.1:5173>.

To run only the frontend:

```bash
pnpm --filter @media-engine/example dev
```

By default it expects the API at `http://127.0.0.1:3000`. Change `VITE_MEDIA_ENGINE_API_URL` when the API lives elsewhere.

The browser uses `@media-engine/sdk`. Provider code and any server configuration stay outside the frontend.

## Check it

```bash
pnpm --filter @media-engine/example typecheck
pnpm --filter @media-engine/example build
```

This is a demonstration, not a finished movie website. Third-party players may not work in every browser, country, or network.

## License

MIT
