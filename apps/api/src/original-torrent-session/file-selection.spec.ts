import { selectRegularTorrentFiles } from './file-selection';

describe('extension-independent torrent file selection', () => {
  it('keeps every non-padding file regardless of extension or media meaning', () => {
    const files = [
      { id: 1, path: 'video/movie.mkv', length: 100 },
      { id: 2, path: 'video/movie.unusual', length: 100 },
      { id: 3, path: 'notes/readme.txt', length: 10 },
      { id: 4, path: 'without-extension', length: 5 },
      { id: 5, path: '.pad/0', length: 20 },
      {
        id: 6,
        path: '_____padding_file_0_if you see this file.txt',
        length: 20,
      },
      { id: 7, path: 'dir/padding_file_is_regular.txt', length: 20 },
    ];

    expect(selectRegularTorrentFiles(files)).toEqual([
      ...files.slice(0, 4),
      files[6],
    ]);
  });
});
