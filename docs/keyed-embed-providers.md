# Direct keyed embed providers

Prepared for Core/Providers/SDK 1.14.0. These providers do not query DDBB.

| Factory                      | Provider              | Native IDs            | Episode selection         |
| ---------------------------- | --------------------- | --------------------- | ------------------------- |
| `vibixStreamingProvider`     | `vibix-streaming`     | Kinopoisk, IMDb       | Inside iframe             |
| `collapsStreamingProvider`   | `collaps-streaming`   | Kinopoisk, IMDb       | Catalog and exact episode |
| `allohaStreamingProvider`    | `alloha-streaming`    | Kinopoisk, IMDb, TMDB | Catalog and exact episode |
| `videoSeedStreamingProvider` | `videoseed-streaming` | Kinopoisk, IMDb, TMDB | Catalog and exact episode |
| `mirageStreamingProvider`    | `mirage-streaming`    | Kinopoisk, IMDb, TMDB | Catalog and exact episode |
| `hdvbStreamingProvider`      | `hdvb-streaming`      | Kinopoisk             | Inside iframe             |

## Usage

```ts
import { MediaEngine } from "@media-engine/core";
import {
  vibixStreamingProvider,
  collapsStreamingProvider,
  allohaStreamingProvider,
  videoSeedStreamingProvider,
  mirageStreamingProvider,
  hdvbStreamingProvider,
} from "@media-engine/providers";

const engine = new MediaEngine({
  streamingProviders: [
    vibixStreamingProvider({ apiKey: process.env.VIBIX_API_KEY }),
    collapsStreamingProvider({ apiKey: process.env.COLLAPS_API_KEY }),
    allohaStreamingProvider({
      apiKey: process.env.ALOHA_API_KEY,
      // This is a public Alloha token authorizing both catalog and iframe.
      allowApiKeyInEmbedUrl: true,
    }),
    videoSeedStreamingProvider({
      apiKey: process.env.VIDEOSEED_API_KEY,
      playerToken: process.env.VIDEOSEED_PLAYER_TOKEN,
    }),
    mirageStreamingProvider({
      apiKey: process.env.MIRAGE_API_KEY,
      playerToken: process.env.MIRAGE_PLAYER_TOKEN,
    }),
    hdvbStreamingProvider({ apiKey: process.env.HDVB_API_KEY }),
  ],
});
```

Register the application's existing metadata providers and IdentityResolver as
usual when it needs TMDB-to-Kinopoisk/IMDb conversion. Native provider capability
metadata stays truthful: passing a TMDB-only query directly to Vibix, Collaps or
HDVB returns null. Core can resolve it through configured identity sources first.
There is no new third-party ID broker or DDBB fallback.

All providers accept `apiKey`, `baseUrl`, `fetch`, `maxResponseBytes`, `name`,
`version`, `playerToken`, and `allowApiKeyInEmbedUrl`. Vibix also accepts
`playerBaseUrl`. API origins must use public credential-free HTTPS. Requests use
the shared bounded JSON client, one request deadline, cancellation and rate-limit
gate; authenticated redirects are refused. No account secrets are returned in
diagnostics. An API response supplies an embed link, not proof of browser playback:
options retain `availability: "unknown"` until the consumer verifies playback.

Movie/series mismatches and contradictory returned IDs are rejected. Exact episode
queries return only catalogued episodes. Episodic anime of any distribution kind
uses the existing anime-native identity and canonical season/episode/absolute
proof, including `animeReleaseEpisode` for split releases. Generic series queries
retain the provider's internal episode selector. Missing entries return null;
invalid responses, authentication failures and rate limits remain provider errors.

## Credentials

An iframe URL is visible to the viewer. Keep `apiKey` on the server. If an upstream
returns that same API key inside its iframe link, the provider refuses the result
with `PROVIDER_UNAUTHORIZED` by default. Supply the separate public player token
issued by that provider through `playerToken`; its `token` query parameter replaces
the returned credential. This does not manufacture or discover a public player key.

For accounts whose provider deliberately uses a single public credential, setting
`allowApiKeyInEmbedUrl: true` explicitly permits it in iframe URLs. That credential
will be visible to viewers and must be treated as public. Never enable this merely
to silence an error, and never expose other services' server keys. Provenance uses
the public embed URL; API lookup URLs and Authorization headers stay server-owned.

The reference API enables a provider when its corresponding `*_API_KEY` is nonempty.
The existing environment uses `ALOHA_API_KEY` (one L); the factory/provider use the
service's Alloha spelling. The current installation uses one verified public
Alloha token for both the API and player. Its old value returned metadata but an
unusable iframe; that value was replaced, and no separate `ALOHA_PLAYER_TOKEN`
or `ALOHA_TOKEN` is configured.
`MIRAGE_PLAYER_TOKEN` and `VIDEOSEED_PLAYER_TOKEN` are separate public player
credentials when the corresponding API key must remain server-only. Shared credential opt-in is
`MEDIA_ENGINE_<NAME>_STREAMING_ALLOW_API_KEY_IN_EMBED_URL=true`, default false.
The operator explicitly enabled this flag for the current public Alloha token.
Alloha's direct adapter makes no DDBB request and does not fetch or refresh keys
from DDBB; future replacement is an explicit operator configuration change.
API-origin overrides use `MEDIA_ENGINE_<NAME>_STREAMING_BASE_URL`; Vibix's player
origin override is `MEDIA_ENGINE_VIBIX_STREAMING_PLAYER_BASE_URL`.

The reference API retains DDBB by default for compatibility. Set
`MEDIA_ENGINE_DDBB_STREAMING_ENABLED=false` for a direct-only installation. Package
consumers simply omit `ddbbStreamingProvider()` from their provider registry.

## First-party API contracts and observations

Checked 2026-11-13 with the configured credentials and the user's explicitly
authorized existing Alloha public player token. No keys were copied from third-party
source-code examples. Public documentation for several services is behind
their account login; the entries below distinguish published documentation from
authenticated endpoint observations.

- [Vibix OpenAPI](https://vibix.org/api/external/documentation),
  [JSON schema](https://vibix.org/api/external/docs/external-api-docs.json): Bearer
  authentication, `GET /api/v1/publisher/videos/kp/{id}` and `/imdb/{id}`.
  The schema has no TMDB lookup. `iframe_url` can be empty while `embed_code`
  contains the public `data-publisher-id`, `data-type`, and `data-id`. The
  [official SDK](https://graphicslab.io/sdk/v2/rendex-sdk.min.js), linked from
  Vibix's own interface, was executed in Chromium: it generated
  `https://river-3-329.kinescopecdn.net/{publisher}/embed/{data-id}` for a movie
  and `/embed-serials/{data-id}` for a series. These IDs differ from API `id`.
  The observed origin is configurable because provider mirrors can change.
- [Collaps API](https://apicollaps.cc/): `GET /list` with `token` and
  `kinopoisk_id` or numeric `imdb_id` (strip `tt`). Result shape is `results[]`,
  with `iframe_url` and seasonal episode maps. Anime uses `anime-film` and
  `anime-series`. **`tmdb_id` was ignored and returned unrelated latest records**;
  it is deliberately excluded from capabilities. The returned ID must match.
- [Alloha API](https://api.alloha.tv/): `GET /?token=...&kp=...`, `imdb=...` or
  `tmdb=...`; `status`, `data`, `id_kp/id_imdb/id_tmdb`, `iframe`,
  `translation_iframe`, `seasons[].episodes[].translation`. Categories distinguish
  films and series; anime film/series examples returned categories 3 and 4.
  `status:error,error_info:"not movie"` means absent content; invalid-token errors
  remain authentication failures. Account documentation is login-protected.
- [Mirage API](https://api.apbugall.org/): independently authenticated endpoint
  with the same legacy schema as Alloha. It has its own key, provider attribution
  and iframe origin. Sharing schema code does not combine the two providers.
- [VideoSeed](https://videoseed.tv/),
  [API](https://api.videoseed.tv/apiv2.php): `item=search`, `token` and
  `kp`/`imdb`/`tmdb`; `data[]`, `type:movie|serial`, `iframe`,
  `translation_iframe`, seasonal `videos` maps. `status:error,data:"no data"`
  means no match. Documentation is inside the account. A separate API key and
  player key must be obtained from the account settings when available.
- [HDVB API](https://apivb.com/api/videos.json): `token` and `id_kp`;
  an array of individual translation players with `kinopoisk_id`, `type`,
  `iframe_url`, `translator`, `quality`, `block`, and `serial_episodes`.
  `id_tmdb`/`id_imdb` returned a missing-parameters error. We do not invent their
  support or undocumented episode URL parameters. Blocked entries are excluded.

Browser and release evidence is recorded separately in the release verification
document. Access to metadata is not proof that an account's public player works.
