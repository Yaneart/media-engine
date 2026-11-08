# Streaming 1.13.5 verification

Checked on 2026-11-08 from the native Windows development environment. No publication,
Git write operations, app dependency upgrade, or full-project verification was performed.

## Included changes

- DDBB defaults to `p2.ddbb.lol`, then `a.ddbb.live` after eligible lookup failures.
  Kinopoisk `2000102` resolved through the fallback and returned four validated player options.
- VeoVeo uses the operator's `VEOVEO_API_KEY` for its own Kinopoisk/IMDb iframe bootstrap,
  verifies the requested external ID on its own catalog details, and loads its episode catalog.
  DDBB is absent from this path. Secrets are omitted from output and request errors.
- Live VeoVeo checks each returned one resolved HLS option: Interstellar by IMDb `tt0816692`,
  Breaking Bad `404900` S01E01, Spirited Away `370` as an anime movie, and Frieren `5401195`
  S01E01 / absolute episode 1 with anime-native identity. These verify discovery and HLS response
  resolution, not browser video decoding or long-running playback.

## Focused checks

- 53 provider/episode/security tests passed: DDBB and VeoVeo test files, shared anime episode
  verification, and hardened fetch security/redirect tests.
- 20 reference API configuration tests passed (`media-engine.config.spec.ts`).
- Core, Providers, and SDK package builds passed. Clean build outputs, release consistency
  (`1.13.5`, API contract `0.20.0`), and dry packs passed (211 / 325 / 10 files).
- Changed-file Prettier and `git diff --check` passed. Full `release:check` was not run.

## Additional token investigation: Alloha and VideoSeed

Only the operator-provided local `ALOHA_API_KEY` and `VIDEOSEED_API_KEY` were used. No keys from
public source examples were used or copied. Requests were bounded read-only lookups.

| Source    | Verified API contract                                                                                                                 | Result                                                                                                                                                                          |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Alloha    | `GET https://api.alloha.tv/?token=<key>&kp=<id>`; also `GET https://apbugall.org/v2/movies/search?kp=<id>` with Bearer authentication | Both authenticate and return exact IDs and iframe data. Legacy category values observed: 1 movie, 2 series, 3 anime movie, 4 TV anime.                                          |
| VideoSeed | `GET https://api.videoseed.tv/apiv2.php?token=<key>&item=movie\|serial&kp=<id>`                                                       | Authenticates and returns matching `id_kp`/`id_imdb`, a typed result, and iframe data for movie `258687` and series `404900`. Anime lookups `370`/`5401195` returned no result. |

The API-issued iframe URLs for both providers contain the same token used for API lookup.
Alloha's supplied player returned HTTP 404 / "content not found" for movie `258687` and series
`404900`, including the browser check for the movie. VideoSeed's supplied player closed the
connection (`UND_ERR_SOCKET` in Node; Chromium navigation also failed). Changing Referer did
not resolve either result. Checking the known alternate player hosts did not produce a working
player. These observations do not prove a global outage or identify the cause: account/player
permissions, the issued iframe token, network restrictions, or upstream configuration remain
unverified.

No Alloha or VideoSeed adapter is included in 1.13.5: successful catalog lookup alone did not
establish working playback. Obtain a working provider-issued player URL or supported direct-stream
access before adding either source. Alloha's current reference implementation distinguishes an
ordinary lookup token from `secret_token` for its direct-stream endpoint.

Contract research used primary implementation sources:

- [VeoVeo in Lampac](https://github.com/lampac-nextgen/lampac/blob/3a1d609e0bf56a9a0d2f4572003a75aa80abefc5/Modules/OnlineRUS/VeoVeo/Controller.cs).
- [Alloha configuration](https://github.com/lampac-nextgen/lampac/blob/3a1d609e0bf56a9a0d2f4572003a75aa80abefc5/Modules/OnlinePaid/Alloha/ModInit.cs)
  and [request implementation](https://github.com/lampac-nextgen/lampac/blob/3a1d609e0bf56a9a0d2f4572003a75aa80abefc5/Modules/OnlinePaid/Alloha/Controller.cs).
- [VideoSeed request implementation](https://github.com/ne3nayskas/lampac-talks/blob/40100af9abe096b8bcbd76323807cf5c374b612c/Online/Controllers/Videoseed.cs)
  and [current Go implementation](https://github.com/Kirill9732/alpac_source/blob/5634e985e2127d02a8fde561cfc31b063df2e76e/internal/litesrc/videoseed.go).

## Release handoff

The operator publishes Core, Providers, then SDK `1.13.5`. After publication, update yaneMedia's
exact Core/Providers dependencies and override, regenerate its lockfile, and pass `VEOVEO_API_KEY`
to `veoVeoStreamingProvider({ apiKey })` in the app composition. The app's existing no-argument
VeoVeo construction must be updated alongside its package upgrade. Do not copy secrets into
tracked files or browser environment variables.
