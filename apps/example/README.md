# Media Engine React example

**English** | [Русский](https://github.com/Yaneart/media-engine/blob/main/apps/example/README.ru.md)

This small app lets you try Media Engine in a browser. It can search, open details, choose an episode, show online player options, discover torrent releases, select any regular torrent file, and play its protected original stream in one native `<video>`.

## Run it

From the repository root:

```bash
pnpm install
# Set one random 32+ character server token in .env first:
# MEDIA_ENGINE_ORIGINAL_TORRENT_TOKEN=...
docker compose --profile torrent-runtime up
```

Open <http://127.0.0.1:5173>.

To run only the frontend:

```bash
pnpm --filter @media-engine/example dev
```

By default it expects the API at `http://127.0.0.1:3000`. Change `VITE_MEDIA_ENGINE_API_URL` when the API lives elsewhere.

The browser uses `@media-engine/sdk` for public discovery. Torrent session create/status/select/stop calls go through a same-origin server-side BFF that adds `MEDIA_ENGINE_ORIGINAL_TORRENT_TOKEN`; the token is never exposed through a `VITE_` variable or included in the browser bundle. Outside Compose, the example server reaches the API through `MEDIA_ENGINE_ORIGINAL_TORRENT_API_URL`, which defaults to `http://127.0.0.1:3000`.

Torrent playback streams the exact selected bytes without extension filtering, probing, conversion, or fallback. `waiting_metadata` means torrent metadata is still being acquired; `Buffering first pieces` means a ready file capability exists but the browser is waiting for stream bytes. A healthy stream can still report `client_format_unsupported` when the browser cannot decode the original container or codecs.

## Check it

```bash
pnpm --filter @media-engine/example typecheck
pnpm --filter @media-engine/example test:unit
pnpm --filter @media-engine/example build
```

This is a demonstration, not a finished movie website. Third-party players and public torrent swarms may not work in every browser, country, or network. Embed players are not loaded automatically: the external link is the default, while embedded playback requires an explicit click and runs with a restricted iframe policy that preserves the third-party player origin and sends only the frontend origin as its referrer. Some player hosts reject completely referrerless requests.

The example does not ship a universal `frame-src` Content Security Policy because player hosts are dynamic. A production deployment should disable embeds or set CSP to an explicit allowlist that matches its selected providers; the external-link flow remains available when framing is blocked.

## License

MIT
