import assert from "node:assert/strict";
import { test } from "node:test";

import { selectAvailabilityTitle } from "./index.ts";

test("availability title keeps the localized title when Rutube is requested", () => {
  const item = { title: " Начало ", originalTitle: " Inception " };

  assert.equal(selectAvailabilityTitle(item, ["rutube-streaming", "kinobd-streaming"]), "Начало");
  assert.equal(selectAvailabilityTitle(item, ["filmix-streaming"]), "Inception");
  assert.equal(selectAvailabilityTitle({ title: " Начало " }, ["filmix-streaming"]), "Начало");
});
