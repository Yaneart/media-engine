# Direct keyed embed providers

See [VeoVeo iframe and 2.0.0 migration](release-2.0.0.md)
for the separate VeoVeo embed factory and removed provider exports.

Prepared for Core/Providers/SDK 2.0.0. These providers do not query DDBB.

| Factory                    | Provider            | Native IDs            | Episode selection         |
| -------------------------- | ------------------- | --------------------- | ------------------------- |
| `collapsStreamingProvider` | `collaps-streaming` | Kinopoisk, IMDb       | Catalog and exact episode |
| `allohaStreamingProvider`  | `alloha-streaming`  | Kinopoisk, IMDb, TMDB | Catalog and exact episode |
| `mirageStreamingProvider`  | `mirage-streaming`  | Kinopoisk, IMDb, TMDB | Catalog and exact episode |

## Usage

```ts
import { MediaEngine } from "@media-engine/core";
import {
  collapsStreamingProvider,
  allohaStreamingProvider,
  mirageStreamingProvider,
} from "@media-engine/providers";

const engine = new MediaEngine({
  streamingProviders: [
    collapsStreamingProvider({ apiKey: process.env.COLLAPS_API_KEY }),
    allohaStreamingProvider({
      apiKey: process.env.ALOHA_API_KEY,
      // This is a public Alloha token authorizing both catalog and iframe.
      allowApiKeyInEmbedUrl: true,
    }),
    mirageStreamingProvider({
      apiKey: process.env.MIRAGE_API_KEY,
      playerToken: process.env.MIRAGE_PLAYER_TOKEN,
    }),
  ],
});
```

Register the application's existing metadata providers and IdentityResolver as
usual when it needs TMDB-to-Kinopoisk/IMDb conversion. Native provider capability
metadata stays truthful: passing a TMDB-only query directly to Collaps returns null. Core can resolve it through configured identity sources first.
There is no new third-party ID broker or DDBB fallback.

All providers accept `apiKey`, `baseUrl`, `fetch`, `maxResponseBytes`, `name`,
`version`, `playerToken`, and `allowApiKeyInEmbedUrl`. API origins must use public credential-free HTTPS. Requests use
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
`MIRAGE_PLAYER_TOKEN` supplies a separate public player credential when the corresponding API key must remain server-only. Shared credential opt-in is
`MEDIA_ENGINE_<NAME>_STREAMING_ALLOW_API_KEY_IN_EMBED_URL=true`, default false.
The operator explicitly enabled this flag for the current public Alloha token.
Alloha's direct adapter makes no DDBB request and does not fetch or refresh keys
from DDBB; future replacement is an explicit operator configuration change.
API-origin overrides use `MEDIA_ENGINE_<NAME>_STREAMING_BASE_URL`.

DDBB, Vibix, VideoSeed and HDVB factories were removed in 2.0.0.

## First-party API contracts and observations

Checked 2026-11-13 with the configured credentials and the user's explicitly
authorized existing Alloha public player token. No keys were copied from third-party
source-code examples. Public documentation for several services is behind
their account login; the entries below distinguish published documentation from
authenticated endpoint observations.

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
  Browser and release evidence is recorded separately in the release verification
  document. Access to metadata is not proof that an account's public player works.
