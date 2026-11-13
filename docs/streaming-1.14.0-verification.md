# Streaming 1.14.0 verification

Prepared 2026-11-13. Publication and the later yaneMedia upgrade remain user-gated
steps. No staging, commits, pushes or npm publication were performed.

## Implemented

Six separate factories: Vibix, Collaps, Alloha, VideoSeed, Mirage and HDVB. Each
authenticates directly with its own API; no adapter queries DDBB. Native ID
capabilities match observed APIs. Core's existing verified identity resolution
handles TMDB queries for providers without a native TMDB endpoint. Unsupported
filters are not sent. Returned IDs and movie/series shape are verified.

Collaps/Alloha/Mirage/VideoSeed expose catalogs and exact episode selection,
including the existing strict anime release/season/absolute mapping. Vibix/HDVB
retain their internal selectors. API and Compose support independent credentials,
origin overrides, streaming timeouts and explicit DDBB disablement. Credential
handling and first-party references are in [the provider guide](./keyed-embed-providers.md).

## Automated checks

- Core, Providers and SDK package builds passed at 1.14.0. No whole-application or
  whole-monorepo build/test/lint/typecheck was run.
- 59 focused provider/shared tests passed: 43 new keyed-provider tests, 2 Alloha
  single-public-token regressions, 11 existing anime-coordinate tests and 3 URL-policy tests.
- 23 focused API configuration tests passed in two suites.
- Changed API entrypoint import graphs: zero TypeScript diagnostics.
- Independent tester confirmed 43 provider and 23 API tests. Additional independent
  fixtures passed for Core TMDB-to-Kinopoisk routing into Vibix/Collaps/HDVB (3),
  URL/secret boundaries (9), Docker origin overrides and all six streaming timeout
  assignments. These fixtures do not substitute for live upstream playback.
- Tester found timeout misclassification and missing Compose origin overrides;
  both were fixed and independently rechecked. All six streaming timeouts were
  also explicitly added and checked. No confirmed code defects remain open.
- Release consistency passed: all three packages/runtime/default User-Agent
  1.14.0; unchanged API contract 0.20.0; changelog 1.14.0.
- Clean dry packs: Core 211, Providers 352, SDK 10 files; test fixtures, temporary
  diagnostics, credentials and .env files are excluded.
- Changed-file Prettier and `git diff --check` passed.

Focused reproduction commands, after package builds:

```powershell
node --test packages\providers\dist\shared\keyed-embed.test.js packages\providers\dist\shared\anime-episode.test.js packages\providers\dist\shared\output-url.test.js
node --test packages\providers\dist\alloha-streaming\availability.test.js
pnpm.cmd --filter @media-engine/api test:unit --runInBand --runTestsByPath src/media-engine/keyed-embed.config.spec.ts src/media-engine/media-engine.config.spec.ts
node scripts\check-release-consistency.mjs
```

## Live API evidence

Authenticated Kinopoisk lookup for Interstellar 258687 and Breaking Bad 404900
returned correct records from all six services. Alloha/Mirage/VideoSeed also
returned matching Interstellar by IMDb tt0816692 and TMDB 157336. Negative
Kinopoisk lookups returned the providers' empty/not-found shapes.

Collaps IMDb lookup requires numeric 0816692. Passing tmdb_id=157336 was silently
ignored and returned unrelated newest records; that filter is deliberately not
supported. HDVB id_tmdb/id_imdb returned a missing-parameters error. Vibix's
current OpenAPI exposes Kinopoisk/IMDb lookup only.

Final built Collaps returned a Spirited Away embed (KP370) and exact Frieren
S1E1/A1 (KP5401195/Shikimori52991), retaining canonical episode identity. VideoSeed
had no records for those two anime IDs; HDVB had Spirited Away but no Frieren.
These are coverage observations for those IDs, not a universal catalog claim.

## Chromium / Playwright evidence and limits

| Provider  | Observed result                                                                                                                                                                                                                                                                                                           |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Collaps   | Actual adapter links on an isolated localhost iframe stand decoded Interstellar and Breaking Bad S1E1: readyState 4, 864x486, advancing about 7 / 5 seconds.                                                                                                                                                              |
| Vibix     | Official SDK on vibix.org decoded the movie and series: readyState 4, 850x478, about 5 seconds. SDK-generated player paths matched the adapter's embed_code mapping. The same official SDK and adapter paths on localhost returned “content not found”.                                                                   |
| HDVB      | API keys accepted for Dune, Interstellar and Breaking Bad. All tested returned translation iframe variants show Video Not Found888, including on the API provider's own origin. Playback is not confirmed; catalog authentication success does not prove player entitlement.                                              |
| Alloha    | Corrected configuration: one working public ALOHA_API_KEY now authorizes both direct API and iframe. Actual adapter links decoded Dune, Dune Part Two and Breaking Bad S1E1 on localhost: readyState4, advancing about7/6/7seconds,854x480/1152x480/854x480. Adapter requests went only to api.alloha.tv; DDBB requests0. |
| Mirage    | Recheck with the existing MIRAGE_API_KEY decoded Dune and Interstellar using ordinary player controls (readyState4,854pxwide,~5-7/~4seconds,full movie durations9325/10144sec). Earlier playback-failure classification was premature. Library public-token opt-in remains separate from token validity.                  |
| VideoSeed | API token accepted and iframe/audio menus load. After the advertising state the issued CDN HLS playlists return emptyHTTP404 in Chromium GETs for Dune and Interstellar (including a translation-specific iframe). Video decoding remains unconfirmed; the exact cause of CDN404 is not established.                      |

Vibix behavior is demonstrably origin-dependent, including with its own SDK. The
precise account/domain restriction is not established. No origin/referer spoofing,
proxy, CAPTCHA bypass or upstream player modification was added. The observed
Vibix player origin can be replaced through the documented option if the operator
has a different official mirror.

Alloha/Mirage/VideoSeed return iframe URLs containing the same credential as their
API key. Library defaults reject shared-key links without explicit operator opt-in.
Mirage needs explicit public-token configuration for its current working shared
credential, not a new API key. VideoSeed's CDN404 remains unresolved independently
of the library's credential exposure guard.

### Other-balancer cause recheck

All five other configured API credentials returned correct Dune, Interstellar and
Breaking Bad records. None can be called invalid for catalog lookup. This does
not assert every credential is authorized for public iframe playback.

Mirage's original key successfully played its main and translation-specific
iframes after ordinary Play control actions. An early programmatic video.play
or one short first-click check was insufficient for its startup behavior. The
actual adapter's default PROVIDER_UNAUTHORIZED here comes from our local shared
credential output policy after successful API lookup; an explicit per-call public
token opt-in returns the normal options. The user's public-token authorization
so far is specific to Alloha, so Mirage settings were not silently changed.

Vibix was compared again using its current official SDK in TWO fresh browser
contexts with the same API-provided publisher/content IDs: localhost SDK showed
content-not-found, official vibix.org SDK produced video readyState4. SDK and
adapter used the same player hostname and path. This proves origin-dependent
behavior, not a parser-only failure or an invalid catalog key; the exact publisher
domain/account rule is still unverified.

HDVB's multiple unmodified iframe variants returned888 for both movie and series
entries that the API did not mark blocked. The result persisted when embedded on
apivb.com itself. No replacement credential, proxy or guessed URL was introduced;
we cannot yet distinguish account/player rights from upstream link availability.

VideoSeed's own player emits its storage.videoseedcdn.com playlist URLs. Browser
GETs without Range returned404 and an empty body for Dune and a translation-specific
Interstellar iframe; a separate Range probe also returned404. No media playlist
transformation in Media Engine was involved. Advertising assets also had aborted
requests, but the content CDN404 was independently reproduced. Geo restrictions,
player-token scope and missing upstream media are possibilities rather than
confirmed causes. No token was changed, and no geo/access workaround was added.

### Alloha recheck and corrected configuration

The user reported that Alloha already played Dune through DDBB. A fresh isolated
guest browser in the actual yaneMedia media page confirmed Dune Part Two decoding
through DDBB's Alloha source, readyState4,1152x480,advancing~10seconds. No normal
user profile/history was used or modified.

Controlled comparison for Dune KP409424 and Dune Part Two KP4540126 found identical
token_movie content identities in DDBB and the authenticated direct API, but
different player tokens and domains. The original configured token returned
correct catalog metadata but its iframe showed404. Keeping that token and changing
only the domain still failed. Using the existing working public player token on
the direct API's original domain decoded both movies. Thus the failure was tied to
the configured token, not missing content or a required DDBB lookup.

The user explicitly authorized using the currently working public token and then
requested one credential named ALOHA_API_KEY. That token was verified for catalog
requests too, so two tokens are unnecessary. The ignored local .env now has only
ALOHA_API_KEY for Alloha authentication; the previous value and ALOHA_PLAYER_TOKEN
were removed. MEDIA_ENGINE_ALOHA_STREAMING_ALLOW_API_KEY_IN_EMBED_URL=true records
the authorized public-token contract. No token value is hard-coded in source,
documentation or tests.

Final actual-provider checks used that one credential for Dune, Dune Part Two and
Breaking Bad S1E1; returned9/12/11options respectively. Instrumented hardened fetch
recorded only https://api.alloha.tv, one request per case, with zero DDBB requests.
Playwright clicked the provider's ordinary Play control and confirmed decoded
video for all three. DDBB supplied the existing public credential once during the
authorized local configuration step; the adapter has no DDBB bootstrap, key refresh
or fallback. Replacement of a future revoked public token remains an explicit
operator change. Server-side iframe fetches alone were also shown insufficient:
a Node request could return404 while the same issued link played in Chromium.

These results do **not** establish all-six production playback. Metadata access,
valid link mapping, a loaded player shell and decoded video are separate findings.
The external player/account limitations remain open; their exact cause is not
proven by these tests. Long viewing, native fullscreen, and real public-domain
deployment were not tested. Temporary servers, browser contexts and artifacts
were cleaned after verification.

## Release handoff

Suggested commit title:

```text
feat(providers): add direct Vibix, Collaps, Alloha, VideoSeed, Mirage and HDVB sources
```

After manually committing/pushing the reviewed changes, publish in dependency
order from the repository root:

```powershell
pnpm.cmd --filter @media-engine/core publish --access public
pnpm.cmd --filter @media-engine/providers publish --access public
pnpm.cmd --filter @media-engine/sdk publish --access public
```

No --no-git-checks is needed. If requested, the repository's full prepublication
gate is `pnpm.cmd release:check`; it was not run under the focused-check scope.
After the user confirms npm publication, upgrade yaneMedia's exact Core/Providers
versions and matching override/lockfile, add its direct provider configuration,
and perform focused integration/browser checks there. SDK is not an app dependency.
