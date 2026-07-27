import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { canStartReferenceTorrentPlayback } from "../src/components/reference-playback-candidate.ts";

describe("reference torrent playback candidate eligibility", () => {
  it("accepts a server-catalogued magnet handoff", () => {
    assert.equal(
      canStartReferenceTorrentPlayback({
        handoff: { kind: "magnet", uri: "magnet:?xt=urn:btih:example" },
      }),
      true,
    );
  });

  it("accepts a server-catalogued torrent-file handoff", () => {
    assert.equal(
      canStartReferenceTorrentPlayback({
        handoff: { kind: "torrent_file", uri: "https://yts.example/download/example.torrent" },
      }),
      true,
    );
  });

  it("rejects external handoffs and handoffs with request metadata", () => {
    assert.equal(
      canStartReferenceTorrentPlayback({
        handoff: { kind: "external", uri: "https://example.test/details" },
      }),
      false,
    );
    assert.equal(
      canStartReferenceTorrentPlayback({
        handoff: {
          kind: "torrent_file",
          uri: "https://example.test/download",
          headers: { authorization: "Bearer secret" },
        },
      }),
      false,
    );
    assert.equal(
      canStartReferenceTorrentPlayback({
        handoff: {
          kind: "torrent_file",
          uri: "https://example.test/download",
          referer: "https://example.test/",
        },
      }),
      false,
    );
    assert.equal(
      canStartReferenceTorrentPlayback({
        handoff: {
          kind: "torrent_file",
          uri: "https://example.test/download",
          method: "POST",
        },
      }),
      false,
    );
  });
});
