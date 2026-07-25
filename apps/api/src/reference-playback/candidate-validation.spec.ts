import { revalidatePlaybackCandidate } from './candidate-validation';
import { TEST_HASH, TEST_MAGNET, torrentCandidate } from './test-helpers';

describe('revalidatePlaybackCandidate', () => {
  const now = Date.parse('2026-07-25T00:00:00.000Z');

  it('returns one normalized server-owned magnet identity', () => {
    expect(
      revalidatePlaybackCandidate(
        catalogued(torrentCandidate()),
        { provider: 'test-torrent', candidateId: 'candidate-1' },
        now,
      ),
    ).toMatchObject({ infoHash: TEST_HASH, magnet: TEST_MAGNET });
  });

  it.each([
    [
      'different candidate ID',
      torrentCandidate(),
      { provider: 'test-torrent', candidateId: 'other' },
      'candidate_identity_mismatch',
    ],
    [
      'expired handoff',
      torrentCandidate({ expiresAt: new Date(now).toISOString() }),
      { provider: 'test-torrent', candidateId: 'candidate-1' },
      'candidate_expired',
    ],
    [
      'malformed expiry',
      torrentCandidate({ expiresAt: 'invalid' }),
      { provider: 'test-torrent', candidateId: 'candidate-1' },
      'candidate_expired',
    ],
    [
      'invalid magnet',
      torrentCandidate({ handoff: { kind: 'magnet', uri: 'magnet:?bad' } }),
      { provider: 'test-torrent', candidateId: 'candidate-1' },
      'candidate_not_playable',
    ],
    [
      'POST handoff',
      torrentCandidate({
        handoff: { kind: 'magnet', uri: TEST_MAGNET, method: 'POST' },
      }),
      { provider: 'test-torrent', candidateId: 'candidate-1' },
      'candidate_not_playable',
    ],
  ] as const)('rejects %s', (_label, candidate, input, code) => {
    try {
      revalidatePlaybackCandidate(catalogued(candidate), input, now);
      throw new Error('Expected candidate revalidation to fail.');
    } catch (error) {
      expect(error).toMatchObject({ code });
    }
  });
});

function catalogued(candidate: ReturnType<typeof torrentCandidate>) {
  return {
    candidate,
    query: { type: 'movie' as const },
    recordedAt: '2026-07-25T00:00:00.000Z',
    expiresAt: '2026-07-25T00:05:00.000Z',
  };
}
