import assert from "node:assert/strict";
import { test } from "node:test";

import { normalizeProviderOutputUrl, normalizePublicHttpUrl } from "./output-url.js";
import { createProviderImage } from "./mapping.js";

test("normalizeProviderOutputUrl rejects unsafe browser targets", () => {
  for (const value of [
    "javascript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "file:///etc/passwd",
    "https://user:password@player.test/embed",
    "https://player.test/embed\n?token=secret",
    "http://localhost/admin",
    "http://service.localhost/admin",
    "http://127.0.0.1/admin",
    "http://2130706433/admin",
    "http://10.0.0.1/admin",
    "http://169.254.169.254/latest/meta-data",
    "http://172.16.0.1/admin",
    "http://192.168.0.1/admin",
    "http://[::1]/admin",
    "http://[::7f00:1]/admin",
    "http://[::ffff:127.0.0.1]/admin",
    "http://[fd00::1]/admin",
  ]) {
    assert.equal(normalizeProviderOutputUrl(value), undefined, value);
  }
});

test("normalizeProviderOutputUrl preserves public HTTP targets and signed query parameters", () => {
  const value =
    "https://cdn.player.test/embed/movie.m3u8?token=a%2Fb%2Bc&expires=1800000000#player";

  assert.equal(normalizeProviderOutputUrl(value), value);
  assert.equal(normalizePublicHttpUrl(value), value);
});

test("createProviderImage applies the output policy at the metadata mapping boundary", () => {
  assert.equal(createProviderImage("http://127.0.0.1/poster.jpg", "poster", "fixture"), undefined);
  assert.deepEqual(
    createProviderImage("https://images.test/poster.jpg?signature=a%2Fb", "poster", "fixture"),
    {
      url: "https://images.test/poster.jpg?signature=a%2Fb",
      type: "poster",
      source: "fixture",
    },
  );
});
