import type { OriginalTorrentFile } from '../original-torrent-runtime';

// BEP 47 clients commonly expose padding entries under .pad or with padding_file names.
// These storage-only entries are the sole filename-based exclusion; extensions are never filtered.
export function selectRegularTorrentFiles(
  files: readonly OriginalTorrentFile[],
): OriginalTorrentFile[] {
  return files.filter((file) => !isPaddingPath(file.path));
}

function isPaddingPath(path: string): boolean {
  return path.split('/').some((component) => {
    const normalized = component.toLowerCase();
    return normalized === '.pad' || normalized.startsWith('_____padding_file_');
  });
}
