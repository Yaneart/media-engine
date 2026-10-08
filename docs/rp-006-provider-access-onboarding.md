# RP-006 provider access onboarding

Checked: 2026-10-07

This document records how to request individual credentials for direct streaming providers. It must
not contain real API tokens, passwords, cookies, private player links, or screenshots with secrets.

Getting a catalog/API token does not automatically permit direct HLS/MP4 extraction. Every request
must separately ask whether the supported contract allows server-side manifests or direct media,
or only search plus an iframe player.

## Recommended order

1. Kodik
2. Vibix
3. Alloha
4. VideoSeed
5. HDVB and Lumex
6. Collaps/Rewall only as an unverified final attempt

## Kodik

Status: manual access request.

The current [Kodik access page](https://kodikplayer.com/) tells site owners to email
`support@kodikres.com` and include their site. The API base is `https://kodik-api.com/`; a request
without a valid token returns an authentication error.

Public traffic requirements, rate limits, domain/IP binding, and direct-stream permissions are not
documented. Access to the database is described as free, but other commercial conditions are not
published.

Send this request:

> Subject: Kodik API access for yaneMedia
>
> Hello. I own the yaneMedia project; site: https://YOUR-DOMAIN. I want to integrate Kodik directly
> through a server-side API.
>
> Please provide:
>
> - an individual API token;
> - current API documentation;
> - supported Kinopoisk, IMDb, and Shikimori lookup;
> - seasons, episodes, and translations;
> - confirmation whether the contract permits manifest/direct HLS output rather than iframe only;
> - domain/IP binding rules;
> - rate limits and commercial terms.
>
> The token will be kept server-side and will not be exposed to the frontend.

Do not use shared tokens published in repositories or forums.

## Vibix

Status: supported self-service token generation after account activation.

1. Contact the official support account [@vibix_tv](https://t.me/vibix_tv).
2. Request a publisher/webmaster account with External API access.
3. Provide the site/application domain and explain that the integration needs server-to-server
   Kinopoisk/IMDb lookup.
4. After activation, sign in at [vibix.org](https://vibix.org/).
5. Open `Settings` -> `API Token` -> `Generate`.
6. Use the token through `Authorize` in the
   [official Swagger UI](https://vibix.org/api/external/documentation).

Send this request:

> Hello. I want to integrate Vibix into yaneMedia through the server-to-server External API. I need
> a publisher/webmaster account for https://YOUR-DOMAIN. The integration needs Kinopoisk/IMDb
> lookup, movies, series, anime, seasons, and exact episodes. Please confirm the access conditions,
> rate limits, whether an API-only integration requires domain registration, and whether direct
> manifests/media are supported or the contract is iframe-only.

Vibix does not publish pricing, numeric rate limits, or an SLA. Registration of a custom publisher
iframe domain is a separate feature, so support must confirm whether it applies to an API-only
server integration.

## Alloha

Status: application form with a traffic requirement.

The [official access form](https://alloha.tv/access/) requires at least 300 visitors per day during
the previous week. Access is available only to site owners.

1. Create a player subdomain such as `player.YOUR-DOMAIN`.
2. Add this DNS record:

   ```text
   player.YOUR-DOMAIN CNAME streamalloha.live
   ```

3. In Yandex Metrica, grant view access to `TV.Alloha@yandex.ru`.
4. Fill in the [access form](https://alloha.tv/access/) with email, login, site address, player
   domain/subdomain, statistics type, and the Metrica counter ID.
5. After approval, use the [Alloha account](https://alloha.tv/login/).
6. Ask where to obtain the API token and current documentation; the public form does not describe
   the token screen.

Add this note to the application or follow-up message:

> I own https://YOUR-DOMAIN and its 300+ daily visitors are confirmed through Yandex Metrica. I need
> a direct server-side API for yaneMedia: Kinopoisk/IMDb/TMDB lookup, seasons, episodes, and
> translations. Please provide an API token, current documentation, rate limits, domain/IP binding
> rules, commercial terms, and confirmation whether manifest/direct HLS is permitted rather than
> iframe only.

If the site is not yet public or does not have the required traffic, this application cannot be
completed honestly.

## VideoSeed

Status: registration followed by manual approval.

1. Register through the [VideoSeed sign-up form](https://videoseed.tv/sign_up.php).
2. Provide the requested login, email, password, site, and payment details.
3. Contact [@videoseedtv](https://t.me/videoseedtv), provide the registration email and domain, and
   request account approval.
4. After approval, obtain the separate API key and API documentation in the account.

Send this request:

> Hello. I registered a publisher account with EMAIL for https://YOUR-DOMAIN. Please approve the
> account and enable API access. I need an individual API key, current documentation,
> Kinopoisk/IMDb/TMDB lookup, seasons and episodes, rate limits, domain/IP binding rules, and
> confirmation of the permitted server-side output types.

The public site does not expose the current API schema or limits. Do not confuse the `.tv` video
balancer with the unrelated legacy `videoseed.ru` advertising service.

## HDVB

Status: manual publisher approval.

The [official HDVB page](https://hdvb-balanser.video/) accepts site owners with at least 1,000
unique visitors per day and excludes adult sites.

Contact:

- [@hdvbsupport](https://t.me/hdvbsupport)
- `hdvb@betumail.com`

Provide the domain, traffic evidence, primary GEO, and content type. Send this request:

> Hello. I own https://YOUR-DOMAIN. Traffic: N unique visitors per day; primary GEO: ...; content:
> movies/series/anime. I want to integrate HDVB through a server-side API. Please provide a
> publisher account, individual API token, current API schema, rate limits, domain/IP binding rules,
> commercial terms, and confirmation of the supported output types.

Do not send private analytics credentials. A public/statistics link or a redacted screenshot is
sufficient unless support provides a secure verification process.

## VideoCDN and Lumex

Status: request new Lumex access; do not look for a legacy shared VideoCDN token.

The old `videocdn.tv` onboarding is no longer reliable. Current access should be requested from
Lumex. The [official Lumex page](https://lumex-balanser.video/) advertises API integration and
requires at least 1,000 unique visitors per day for online-cinema sites, excluding adult sites.

Contact:

- [@hdvbsupport](https://t.me/hdvbsupport)
- `helpdesk@lumex.ink`

Send this request:

> Hello. I want to integrate Lumex (the provider previously known as VideoCDN) into yaneMedia for
> https://YOUR-DOMAIN. Traffic: N unique visitors per day. Please provide a publisher/API account,
> individual token, current documentation, external-ID and episode capabilities, rate limits,
> domain/IP binding rules, commercial terms, and confirmation of the permitted server-side output
> types.

The VideoCDN-to-Lumex relationship is reported by
[F6 research](https://www.f6.ru/blog/pirate-reserve/), not by a public Lumex migration document.
Support must confirm the relationship and current contract in writing.

## Collaps and Rewall

Status: contact-only and unverified; issuance of new accounts is not confirmed.

The old Collaps site and account flow are not usable. The remaining historical support contact is
[@collaps_support](https://t.me/collaps_support). F6 associates Rewall with the former
Collaps/Tabus infrastructure, but this is not first-party onboarding documentation.

Send this request:

> Hello. I need current Collaps/Rewall publisher and API access for https://YOUR-DOMAIN. Please
> confirm whether you issue new accounts. If so, please provide an individual API token, the current
> API base URL and schema, supported external IDs and episodes, rate limits, domain/IP binding rules,
> commercial terms, and supported server-side output types.

Reject the integration if support offers only a shared token, an undocumented private endpoint, or
credentials copied from another site.

## Providers without a user token

- Videasy, VidCore, and APIPlayer expose public endpoints but failed the RP-006 availability and
  provenance requirements; a token is not the blocker.
- VeoVeo, VideoHUB, AniLiberty, Aderom, and Rutube currently need no separate user token.
- KinoBD and DDBB also need no user token, but remain aggregate fallback/discovery paths.

## Secret handling after approval

1. Do not paste tokens into chat, issues, documentation, screenshots, or source code.
2. Store the original credential in a password manager.
3. When its adapter is implemented, place the token only in the ignored local `.env` under the
   exact variable name added by that task.
4. Tell Codex only which provider access was received. Codex can verify local key presence without
   printing its value.
5. Record the documentation URL, contract date, domain/IP restrictions, quota, and contact channel
   alongside the secret in the password manager.
6. Rotate any token that was exposed in a public repository, browser bundle, screenshot, or chat.

## Legal checkpoint

F6 describes these video balancers as part of an online-piracy ecosystem. Provider access does not
establish that the provider owns distribution rights for every returned work. Before production
use, confirm that the intended catalog, territory, embedding, and direct-stream behavior are lawful
for the project's deployment jurisdiction.
