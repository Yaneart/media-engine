import { MediaEngine } from "../packages/core/dist/index.js";
import {
  shikimoriGraphqlProvider,
  tmdbOfficialProvider,
} from "../packages/providers/dist/index.js";

const apiKey = process.env.TMDB_API_KEY?.trim();
const userAgent = process.env.MEDIA_ENGINE_SHIKIMORI_USER_AGENT?.trim();
if (!apiKey || !userAgent) {
  throw new Error(
    "TMDB_API_KEY and MEDIA_ENGINE_SHIKIMORI_USER_AGENT are required in the process environment.",
  );
}

const tmdb = tmdbOfficialProvider({ apiKey });
const shikimori = shikimoriGraphqlProvider({ userAgent });
const tmdbCases = [
  { type: "movie", id: "157336" },
  { type: "movie", id: "496243" },
  { type: "series", id: "1399" },
  { type: "series", id: "1396" },
  { type: "series", id: "126308" },
];
const animeCases = ["1535", "52991", "52299", "40748", "42203", "199"];
const report = { tmdbDetails: [], animeDetails: [], tmdbSearch: [], animeSearch: [] };

for (const entry of tmdbCases) {
  const measurement = await measure(() =>
    tmdb.getDetails({ type: entry.type, ids: { tmdb: entry.id }, language: "ru" }, {}),
  );
  const details = measurement.value?.details;
  report.tmdbDetails.push({
    id: entry.id,
    type: entry.type,
    complete: isComplete(details),
    imdb: Boolean(details?.ids?.imdb),
    ms: measurement.ms,
  });
  for (const title of uniqueTitles(details)) {
    const search = await measure(() =>
      tmdb.search({ title, type: entry.type, limit: 3, language: "ru" }, {}),
    );
    report.tmdbSearch.push({
      id: entry.id,
      title,
      found: search.value.some(({ item }) => item.ids?.tmdb === entry.id && Boolean(item.ids.imdb)),
      ms: search.ms,
    });
    await delay(300);
  }
}

for (const id of animeCases) {
  const measurement = await measure(() =>
    shikimori.getDetails({ type: "anime", ids: { shikimori: id }, language: "ru" }, {}),
  );
  const details = measurement.value?.details;
  report.animeDetails.push({
    id,
    complete: isComplete(details),
    kind: details?.type === "anime" ? details.animeKind : undefined,
    mal: Boolean(details?.ids?.myAnimeList),
    ms: measurement.ms,
  });
  for (const title of uniqueTitles(details)) {
    const search = await measure(() =>
      shikimori.search({ title, type: "anime", limit: 5, language: "ru" }, {}),
    );
    report.animeSearch.push({
      id,
      title,
      found: search.value.some(
        ({ item }) => item.ids?.shikimori === id && Boolean(item.ids.myAnimeList),
      ),
      ms: search.ms,
    });
    await delay(220);
  }
}

const engine = new MediaEngine({ providers: [tmdb, shikimori] });
const routed = await engine.getDetails({
  type: "anime",
  ids: { shikimori: "199", myAnimeList: "199" },
  language: "ru",
});
report.animeRouting = {
  requested: routed.meta.providers.requested,
  route: routed.meta.metadata?.route,
  type: routed.details?.type,
};

console.log(JSON.stringify(report, null, 2));

const failed = Object.values(report)
  .filter(Array.isArray)
  .flat()
  .some((entry) => entry.complete === false || entry.found === false);
if (
  failed ||
  report.animeRouting.route !== "primary" ||
  report.animeRouting.type !== "anime" ||
  report.animeRouting.requested.join(",") !== "shikimori-graphql"
) {
  process.exitCode = 1;
}

function uniqueTitles(details) {
  const cyrillicAlias = details?.alternativeTitles?.find((title) => /[а-яё]/iu.test(title));
  return [...new Set([details?.title, details?.originalTitle, cyrillicAlias].filter(Boolean))];
}

function isComplete(details) {
  return Boolean(
    details?.title?.trim() &&
    details.description?.trim() &&
    details.year &&
    details.poster?.url?.startsWith("https://") &&
    details.backdrop?.url?.startsWith("https://"),
  );
}

async function measure(operation) {
  const startedAt = Date.now();
  return { value: await operation(), ms: Date.now() - startedAt };
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
