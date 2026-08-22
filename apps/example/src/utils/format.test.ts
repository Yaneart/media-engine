import assert from "node:assert/strict";
import { test } from "node:test";
import type { AvailabilityOption } from "../state/index.ts";
import {
  formatCountedLabel,
  groupEmbedPlayers,
  groupPrimaryPlayerOptions,
  hasExactEpisodeQuery,
} from "./format.ts";

test("single player labels omit a redundant count", () => {
  assert.equal(formatCountedLabel("Alloha", 1), "Alloha");
  assert.equal(formatCountedLabel("Collaps", 2), "Collaps (2)");
});

test("primary player separates sources, voiceovers, and sorted qualities", () => {
  const sources = groupPrimaryPlayerOptions([
    createOption({ id: "720", height: 720, label: "720p" }),
    createOption({ id: "1080", height: 1080, label: "1080p" }),
    createOption({
      id: "veo",
      kind: "hls",
      player: "VeoVeo",
      provider: "veoveo-streaming",
      translation: "Default",
    }),
  ]);

  assert.deepEqual(
    sources.map((source) => source.label),
    ["Filmix", "VeoVeo"],
  );
  assert.equal(sources[0]?.voices[0]?.label, "LostFilm");
  assert.deepEqual(
    sources[0]?.voices[0]?.options.map((option) => option.id),
    ["1080", "720"],
  );
  assert.equal(sources[1]?.voices[0]?.label, "Встроенная дорожка");
});

test("embed list contains one entry per player and prefers an available embed", () => {
  const players = groupEmbedPlayers([
    createOption({ id: "unknown", kind: "external", player: "alloha", availability: "unknown" }),
    createOption({ id: "available", kind: "embed", player: "Alloha" }),
    createOption({ id: "collaps", kind: "embed", player: "Collaps" }),
  ]);

  assert.deepEqual(
    players.map((player) => player.label),
    ["Alloha", "Collaps"],
  );
  assert.equal(players[0]?.option.id, "available");
});

test("series and anime require an exact episode query in the primary player", () => {
  assert.equal(
    hasExactEpisodeQuery({ type: "series", seasonNumber: 1, episodeNumber: 2 }, "series"),
    true,
  );
  assert.equal(hasExactEpisodeQuery({ type: "series", seasonNumber: 1 }, "series"), false);
  assert.equal(hasExactEpisodeQuery({ type: "anime", absoluteEpisodeNumber: 12 }, "anime"), true);
  assert.equal(hasExactEpisodeQuery({ type: "anime" }, "anime"), false);
});

function createOption({
  availability = "available",
  height = 720,
  id,
  kind = "hls",
  label = "720p",
  player = "Filmix",
  provider = "filmix-streaming",
  translation = "LostFilm",
}: {
  availability?: AvailabilityOption["availability"];
  height?: number;
  id: string;
  kind?: AvailabilityOption["player"]["kind"];
  label?: string;
  player?: string;
  provider?: string;
  translation?: string;
}): AvailabilityOption {
  return {
    id,
    provider,
    player: { kind, label: player },
    translation: { title: translation, type: "voiceover", language: "ru" },
    quality: { label, height },
    access: { url: `https://example.com/${id}` },
    availability,
  };
}
