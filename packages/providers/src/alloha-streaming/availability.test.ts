import assert from "node:assert/strict";
import { test } from "node:test";
import type { StreamQuery } from "@media-engine/core";
import { allohaStreamingProvider } from "./index.js";

const token = "public-alloha-fixture-token";
const embed = (extra = "") =>
  `https://player.example/?token_movie=content123&token=${token}${extra}`;

for (const exact of [false, true]) {
  test(`Alloha uses one public token for API and every ${exact ? "episode" : "movie"} iframe without DDBB`, async () => {
    const urls: string[] = [];
    const kp = exact ? "404900" : "409424";
    const episode = {
      episode: 1,
      iframe: embed("&season=1&episode=1"),
      translation: {
        34: { translation: "LostFilm", iframe: embed("&season=1&episode=1&translation=34") },
      },
    };
    const provider = allohaStreamingProvider({
      apiKey: token,
      allowApiKeyInEmbedUrl: true,
      baseUrl: "https://api.example",
      fetch: async (input) => {
        const url = new URL(input);
        urls.push(url.href);
        assert.equal(url.origin, "https://api.example");
        assert.equal(url.searchParams.get("token"), token);
        assert.equal(url.searchParams.get("kp"), kp);
        return Response.json({
          status: "success",
          data: {
            name: exact ? "Breaking Bad" : "Dune",
            category: exact ? 2 : 1,
            id_kp: Number(kp),
            token_movie: "content123",
            iframe: embed(),
            translation_iframe: { 66: { name: "Dub", iframe: embed("&translation=66") } },
            ...(exact ? { seasons: { 1: { season: 1, episodes: { 1: episode } } } } : {}),
          },
        });
      },
    });
    const query: StreamQuery = exact
      ? { type: "series", ids: { kinopoisk: kp }, seasonNumber: 1, episodeNumber: 1 }
      : { type: "movie", ids: { kinopoisk: kp } };
    const result = await provider.getAvailability(query, {});
    assert.equal(urls.length, 1);
    assert.equal(result?.options.length, 2);
    assert.ok(
      result?.options.every(
        (option) => option.provider === "alloha-streaming" && option.discovery === "direct",
      ),
    );
    for (const url of [
      ...result!.options.flatMap((option) => [option.access.url, option.sourceUrl]),
      ...result!.sourceProviders.map((source) => source.url),
    ]) {
      assert.equal(new URL(url!).searchParams.get("token"), token);
    }
    if (exact) {
      assert.deepEqual(result?.options[0]?.episode, { seasonNumber: 1, episodeNumber: 1 });
      assert.equal(result?.episodes?.length, 1);
    }
  });
}
