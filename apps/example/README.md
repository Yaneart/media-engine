# Media Engine example app

**English** | [Русский](README.ru.md)

This is a small React app where you can try Media Engine in a browser. It can search, open details,
show player options, discover torrent releases, and play a selected original file.

It is a demonstration, not a finished movie website.

## Run the complete example

You need Docker and pnpm. From the repository root:

```bash
pnpm install
cp .env.example .env
openssl rand -hex 32
```

Copy the generated value into `.env` after `MEDIA_ENGINE_ORIGINAL_TORRENT_TOKEN=`, then run:

```bash
docker compose up -d
```

Open <http://127.0.0.1:5173>. The API is at <http://127.0.0.1:3000>.

Stop everything with:

```bash
docker compose down
```

## Run only the frontend

```bash
pnpm --filter @media-engine/example dev
```

By default the frontend expects the API at `http://127.0.0.1:3000`. Set
`VITE_MEDIA_ENGINE_API_URL` if your API uses another address.

## A few useful details

The browser uses `@media-engine/sdk` for normal API calls. Protected torrent-session calls go
through a tiny server-side BFF, so `MEDIA_ENGINE_ORIGINAL_TORRENT_TOKEN` never becomes part of the
browser bundle.

Torrent playback sends the selected file exactly as it is. Media Engine does not convert or
transcode it. A healthy stream may still fail to play when the browser does not support that
container or codec.

Third-party players open as external links by default. Embedding one requires an explicit click and
may still be blocked by the player host or your Content Security Policy. In production, either keep
embeds disabled or use a small explicit `frame-src` allowlist.

Public players and torrent swarms can be unavailable in some countries or networks. That is normal
for a demo built on third-party sources.

## Checks

```bash
pnpm --filter @media-engine/example typecheck
pnpm --filter @media-engine/example test:unit
pnpm --filter @media-engine/example build
```

## License

MIT
