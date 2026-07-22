import assert from "node:assert/strict";
import { test } from "node:test";

import type { AniLibertyReleaseSummary } from "./client.js";
import { matchesAniLibertyRelease, selectAniLibertyRelease } from "./matching.js";

const releases: AniLibertyReleaseSummary[] = [
  {
    id: 10290,
    year: 1999,
    name: {
      main: "Ван-Пис",
      english: "One Piece",
      alternative: "Большой куш; One Piece TV",
    },
    blockedByGeo: false,
    blockedByCopyrights: false,
  },
  {
    id: 10291,
    year: 2026,
    name: { main: "Ван-Пис: Героини", english: "One Piece: Heroines" },
    blockedByGeo: false,
    blockedByCopyrights: false,
  },
];

test("selectAniLibertyRelease requires exact normalized title and year identity", () => {
  assert.equal(
    selectAniLibertyRelease(releases, { type: "anime", title: " one   piece ", year: 1999 })?.id,
    10290,
  );
  assert.equal(
    selectAniLibertyRelease(releases, { type: "anime", title: "Ван Пис", year: 1999 })?.id,
    10290,
  );
  assert.equal(
    selectAniLibertyRelease(releases, { type: "anime", title: "Большой куш", year: 1999 })?.id,
    10290,
  );
  assert.equal(
    selectAniLibertyRelease(releases, { type: "anime", title: "One", year: 1999 }),
    undefined,
  );
  assert.equal(selectAniLibertyRelease(releases, { type: "anime", title: "One Piece" }), undefined);
  assert.equal(
    selectAniLibertyRelease(releases, { type: "anime", title: "One Piece", year: 2026 }),
    undefined,
  );
});

test("selectAniLibertyRelease rejects ambiguous exact identities", () => {
  const duplicate: AniLibertyReleaseSummary = { ...releases[0]!, id: 50000 };

  assert.equal(
    selectAniLibertyRelease([...releases, duplicate], {
      type: "anime",
      title: "One Piece",
      year: 1999,
    }),
    undefined,
  );
});

test("matchesAniLibertyRelease revalidates the loaded release", () => {
  assert.equal(
    matchesAniLibertyRelease(releases[0]!, {
      type: "anime",
      title: "One Piece",
      year: 1999,
    }),
    true,
  );
  assert.equal(
    matchesAniLibertyRelease(releases[0]!, {
      type: "anime",
      title: "One Piece",
      year: 2000,
    }),
    false,
  );
});
