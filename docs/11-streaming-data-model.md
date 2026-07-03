# Media Engine Streaming Data Model

## Purpose

Streaming data describes where and how an application can open a playable option for an already identified media item or episode.

It is separate from metadata.

Metadata answers:

```txt
What is this movie, series, or anime?
```

Streaming answers:

```txt
Where can this item or episode be watched, and which player option should the UI show?
```

Media Engine does not become a video host or a media player. It returns normalized availability and player data. The application renders the iframe, video element, modal, player selector, or external link.

## Design Rules

- Streaming providers are separate from metadata providers.
- Search and details must work without streaming providers.
- Streaming results are resolved after metadata search/details.
- Raw provider responses are not part of the public model.
- Provider-specific URLs, headers, and embed rules must be normalized.
- Illegal, disallowed, or unclear sources must not be implemented.
- The frontend owns playback UI and user interaction.

## Future Flow

```txt
search title
  -> get details
  -> choose media item or episode
  -> get availability
  -> choose provider/player/translation/quality
  -> UI opens iframe/video/external page
```

For series and anime, the query should usually identify one episode. For movies, the query identifies the media item.

## StreamQuery

`StreamQuery` identifies the media item or episode for which stream/player options are requested.

```ts
export interface StreamQuery {
  type: MediaType;
  ids?: ExternalIds;
  title?: string;
  year?: number;
  seasonNumber?: number;
  episodeNumber?: number;
  absoluteEpisodeNumber?: number;
  providers?: string[];
}
```

Rules:

- `ids` are preferred over title matching.
- `type` is required.
- `seasonNumber` and `episodeNumber` identify TV-style episodes.
- `absoluteEpisodeNumber` supports anime-style numbering.
- `providers` optionally restricts lookup to selected streaming providers.

## MediaAvailability

`MediaAvailability` is the top-level response for one stream lookup.

```ts
export interface MediaAvailability {
  query: StreamQuery;
  item?: StreamMediaItem;
  episodes?: StreamEpisodeAvailability[];
  options: StreamOption[];
  sourceProviders: StreamingProviderSource[];
  checkedAt: string;
}
```

Rules:

- `options` can be empty when no playable option is found.
- `checkedAt` is an ISO timestamp from the engine.
- `episodes` is optional and used when a provider returns an episode map.
- `sourceProviders` describes which streaming providers contributed data.

## StreamMediaItem

`StreamMediaItem` is a compact normalized identity used in streaming responses.

```ts
export interface StreamMediaItem {
  type: MediaType;
  title?: string;
  originalTitle?: string;
  year?: number;
  ids?: ExternalIds;
}
```

It must not duplicate the full metadata details model. Applications should use `getDetails` for rich metadata.

## StreamEpisodeAvailability

`StreamEpisodeAvailability` describes episode-level availability.

```ts
export interface StreamEpisodeAvailability {
  seasonNumber?: number;
  episodeNumber?: number;
  absoluteEpisodeNumber?: number;
  title?: string;
  options: StreamOption[];
}
```

Rules:

- Movie availability does not need episode entries.
- Series usually use `seasonNumber` and `episodeNumber`.
- Anime providers may use `absoluteEpisodeNumber`.
- Episode entries can share player options with the top-level `options` list only if references are explicit in the future implementation.

## StreamOption

`StreamOption` is one selectable player or stream candidate.

```ts
export interface StreamOption {
  id: string;
  provider: string;
  player: PlayerSource;
  translation?: TranslationInfo;
  quality?: QualityInfo;
  subtitles?: SubtitleTrack[];
  audio?: AudioTrack[];
  episode?: StreamEpisodeRef;
  access: StreamAccess;
  availability: StreamAvailabilityStatus;
  expiresAt?: string;
  sourceUrl?: string;
}
```

Rules:

- `id` is stable only within one response unless a provider guarantees stable IDs.
- `provider` is the streaming provider name, for example `kodik`.
- `player` tells the UI what kind of player option this is.
- `translation`, `quality`, `subtitles`, and `audio` are normalized for UI filtering.
- `access` contains the playable target and allowed request metadata.
- `sourceUrl` is a provider page URL for debugging or attribution when allowed.

## PlayerSource

`PlayerSource` describes how the frontend can present the option.

```ts
export interface PlayerSource {
  kind: "embed" | "hls" | "mp4" | "external";
  label: string;
  providerPlayerId?: string;
}
```

Meanings:

- `embed`: UI should render an iframe or provider-hosted player.
- `hls`: UI may render an HLS stream with a compatible player.
- `mp4`: UI may render a direct video file when allowed.
- `external`: UI should open or link to an external page.

## StreamAccess

`StreamAccess` contains the actual target needed by the frontend.

```ts
export interface StreamAccess {
  url: string;
  method?: "GET" | "POST";
  headers?: Record<string, string>;
  referer?: string;
}
```

Rules:

- `headers` are included only when a provider allows clients to use them.
- Secrets, private API keys, cookies, and account tokens must not be exposed to browser clients.
- Server-side SDK/API layers may enforce additional filtering before returning access data.

## TranslationInfo

`TranslationInfo` describes dubbing, voice-over, subtitles, or original audio.

```ts
export interface TranslationInfo {
  id?: string;
  title: string;
  type: "dub" | "voiceover" | "subtitles" | "original" | "unknown";
  language?: string;
  team?: string;
}
```

Examples:

- AniDUB Russian dub;
- original Japanese audio with Russian subtitles;
- English subtitles;
- unknown provider label.

## QualityInfo

`QualityInfo` describes normalized quality.

```ts
export interface QualityInfo {
  label: string;
  height?: number;
  width?: number;
  bitrateKbps?: number;
  codec?: string;
}
```

Examples:

- `360p`;
- `720p`;
- `1080p`;
- `auto`.

## SubtitleTrack

```ts
export interface SubtitleTrack {
  language?: string;
  label?: string;
  format?: "vtt" | "srt" | "ass" | "unknown";
  url?: string;
}
```

Subtitle URLs are optional because some embed players manage subtitles internally.

## AudioTrack

```ts
export interface AudioTrack {
  language?: string;
  label?: string;
  codec?: string;
}
```

## StreamEpisodeRef

```ts
export interface StreamEpisodeRef {
  seasonNumber?: number;
  episodeNumber?: number;
  absoluteEpisodeNumber?: number;
}
```

## StreamingProviderSource

```ts
export interface StreamingProviderSource {
  provider: string;
  url?: string;
  ids?: ExternalIds;
}
```

This mirrors metadata source attribution but belongs to streaming results.

## StreamAvailabilityStatus

```ts
export type StreamAvailabilityStatus =
  | "available"
  | "region_locked"
  | "temporarily_unavailable"
  | "requires_account"
  | "unknown";
```

Rules:

- `available` means the provider returned a usable option.
- `region_locked` means the provider reports geographic restriction.
- `temporarily_unavailable` means retrying later may work.
- `requires_account` means the source needs authentication or subscription and should not expose private credentials.
- `unknown` is used when the provider does not expose enough information.

## UI Player Selection

The UI should be able to group options by:

- provider;
- player kind;
- translation;
- quality;
- subtitle language;
- episode.

Example grouping:

```txt
Kodik
  AniDUB / 720p / embed
  Subtitles / 1080p / embed

Alternative Provider
  Original / 1080p / hls
```

The engine should return enough normalized data for this grouping, but it should not dictate the UI layout.

## Provider Responsibilities

A streaming provider should:

- resolve by strong external IDs when possible;
- avoid unsafe title-only matching unless the provider has strong disambiguation;
- normalize translations, qualities, subtitles, audio tracks, and episode numbers;
- return multiple options when available;
- report provider failures through the engine error model;
- avoid exposing secrets or account-bound data.

## Not In This Task

`TASK-050` does not implement:

- TypeScript source files;
- `StreamingProvider` runtime contract;
- engine `getAvailability` method;
- NestJS API endpoints;
- React player UI;
- real Kodik or other streaming provider integration.

Those belong to later v0.5 tasks.
