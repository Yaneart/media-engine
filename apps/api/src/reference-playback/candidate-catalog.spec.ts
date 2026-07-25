import { TorrentCandidateCatalog } from './candidate-catalog';
import { torrentCandidate, torrentResponse } from './test-helpers';

describe('TorrentCandidateCatalog', () => {
  it('records isolated fresh copies and resolves them by provider plus ID', () => {
    let now = Date.parse('2026-07-25T00:00:00.000Z');
    const catalog = new TorrentCandidateCatalog(
      { candidateTtlMs: 5_000, maxCandidates: 3 },
      { now: () => now },
    );
    const candidate = torrentCandidate();

    expect(catalog.record(torrentResponse([candidate]))).toBe(1);
    candidate.title = 'mutated';

    const first = catalog.get('test-torrent', 'candidate-1');
    expect(first?.candidate.title).toBe('Example Movie 2026');
    first!.candidate.title = 'also mutated';
    expect(catalog.get('test-torrent', 'candidate-1')?.candidate.title).toBe(
      'Example Movie 2026',
    );
    expect(catalog.size).toBe(1);

    now += 5_001;
    expect(catalog.get('test-torrent', 'candidate-1')).toBeUndefined();
    expect(catalog.size).toBe(0);
  });

  it('uses the earlier candidate expiry and skips expired or malformed entries', () => {
    const now = Date.parse('2026-07-25T00:00:00.000Z');
    const catalog = new TorrentCandidateCatalog(
      { candidateTtlMs: 60_000, maxCandidates: 5 },
      { now: () => now },
    );

    expect(
      catalog.record(
        torrentResponse([
          torrentCandidate({
            id: 'short-lived',
            expiresAt: new Date(now + 2_000).toISOString(),
          }),
          torrentCandidate({
            id: 'expired',
            expiresAt: new Date(now).toISOString(),
          }),
          torrentCandidate({ id: 'malformed', expiresAt: 'not-a-date' }),
          torrentCandidate({ id: ' unsafe ' }),
        ]),
      ),
    ).toBe(1);
    expect(catalog.get('test-torrent', 'short-lived')?.expiresAt).toBe(
      new Date(now + 2_000).toISOString(),
    );
  });

  it('keeps a bounded least-recently-used catalog', () => {
    const catalog = new TorrentCandidateCatalog({
      candidateTtlMs: 60_000,
      maxCandidates: 2,
    });
    catalog.record(
      torrentResponse([
        torrentCandidate({ id: 'first' }),
        torrentCandidate({ id: 'second' }),
      ]),
    );
    expect(catalog.get('test-torrent', 'first')).toBeDefined();
    catalog.record(torrentResponse([torrentCandidate({ id: 'third' })]));

    expect(catalog.get('test-torrent', 'second')).toBeUndefined();
    expect(catalog.get('test-torrent', 'first')).toBeDefined();
    expect(catalog.get('test-torrent', 'third')).toBeDefined();
    catalog.clear();
    expect(catalog.size).toBe(0);
  });
});
