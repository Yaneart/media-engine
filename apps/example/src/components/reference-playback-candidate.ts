interface ReferencePlaybackCandidate {
  handoff: {
    kind: string;
    uri: string;
    method?: string;
    headers?: Readonly<Record<string, string>>;
    referer?: string;
  };
}

export function canStartReferenceTorrentPlayback(candidate: ReferencePlaybackCandidate): boolean {
  const { handoff } = candidate;

  return (
    (handoff.kind === "magnet" || handoff.kind === "torrent_file") &&
    handoff.headers === undefined &&
    handoff.referer === undefined &&
    (handoff.method === undefined || handoff.method === "GET")
  );
}
