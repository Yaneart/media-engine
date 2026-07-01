# Media Engine Merge Strategy

## Purpose

Merge strategy turns multiple provider results into one normalized search result or details object.

Example:

```txt
TMDB      -> Interstellar, tmdb=157336, imdb=tt0816692
IMDb      -> Interstellar, imdb=tt0816692
Kinopoisk -> Interstellar, kinopoisk=258687, imdb=tt0816692
```

The engine should identify one movie, not three.

## Match Priority

```txt
1. exact external IDs
2. exact title + year + type
3. normalized title + year + type
4. weak title similarity
5. provider confidence
```

Early versions use levels 1-3 for automatic merge. Weak matches are diagnostic only.

## MatchStrength

```ts
type MatchStrength =
  | "exact_id"
  | "exact_title_year_type"
  | "normalized_title_year_type"
  | "weak"
  | "none";
```

## Strong IDs

Strong external IDs:

- IMDb;
- TMDB;
- Kinopoisk;
- Shikimori;
- MyAnimeList.

If at least one strong ID matches, results can be grouped.

## Unsafe Merge Cases

Do not automatically merge when:

- strong IDs conflict;
- media types differ;
- years differ without a shared external ID;
- only part of the title matches;
- one result is anime and another is series without exact ID.

Example: `Fullmetal Alchemist` and `Fullmetal Alchemist: Brotherhood` must not be merged only because titles are similar.

## External ID Merge

External IDs are merged as a map. Conflicting values must not be silently overwritten.

On conflict:

- keep value from provider priority;
- add `EngineWarning`;
- preserve diagnostics in debug mode.

## Provider Priority

Default for movies and series:

```txt
tmdb > imdb > kinopoisk > shikimori
```

Default for anime:

```txt
shikimori > tmdb > imdb > kinopoisk
```

Provider priority is a conflict-resolution default, not an absolute truth.

## Field Rules

### title

Choose:

1. requested language title;
2. title from provider priority;
3. first non-empty title.

Other titles go to `alternativeTitles`.

### originalTitle

Use the first non-empty original title from provider priority.

### year

If years match, use that year. If they conflict after an exact ID match, keep provider-priority value and add warning.

### releaseDate

Prefer the most precise date.

### description

Choose requested language, then longest useful description, then provider priority.

### poster/backdrop

Prefer valid URL, larger image, then provider priority.

### genres

Merge unique normalized genre names.

### ratings

Keep ratings per source. Do not average into one global rating in early versions.

### persons

Merge by external IDs or normalized name and role. Early versions may keep simple unique entries.

### seasons/episodes

Merge carefully. Early versions can keep seasons and episodes from the primary provider.

## Score

Score is from `0` to `1`:

```txt
exact external ID match        -> 1.0
exact title + year + type      -> 0.9
normalized title + year + type -> 0.8
title + type without year      -> 0.6
weak title similarity          -> 0.4
```

Provider confidence may adjust final score.

## MergeStrategy

```ts
export interface MergeStrategy {
  mergeSearchResults(
    results: ProviderSearchResult[],
    context: MergeContext
  ): MediaSearchResult[];

  mergeDetails(
    results: ProviderDetailsResult[],
    context: MergeContext
  ): MediaDetails | null;
}
```

## DefaultMergeStrategy

`DefaultMergeStrategy` is the built-in implementation used by `MediaEngine` when no custom merge strategy is passed.

It should stay deterministic:

- same inputs produce the same output order;
- provider priority is explicit;
- conflicts produce warnings;
- provider input objects are not mutated.

```ts
export interface MergeContext {
  query?: SearchQuery | DetailsQuery;
  language?: string;
  providerPriority?: string[];
  debug?: boolean;
  warnings?: EngineWarning[];
}
```

## v0.1 Search Algorithm

```txt
1. Group by exact external ID.
2. Fallback group by normalized title + year + type.
3. Merge IDs, ratings, genres, and alternative titles.
4. Select title, poster, description by simple rules.
5. Calculate score.
6. Sort by score.
```

## v0.1 Details Algorithm

```txt
1. Return null if there are no details results.
2. Pick primary result by provider priority.
3. Merge external IDs, ratings, genres, and images.
4. Keep persons/seasons/episodes from primary result.
5. Add warnings for conflicts.
```

## Restrictions

Merge strategy must not:

- call external APIs;
- import provider clients;
- import NestJS;
- mutate provider results;
- silently overwrite conflicting IDs;
- auto-merge weak matches in early versions;
- mix metadata with streaming availability.
