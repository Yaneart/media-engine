import { hasAsciiControlCharacters } from './text-validation';

describe('shared API text validation', () => {
  it.each(['\0', '\n', '\u001f', '\u007f', 'safe\ttext'])(
    'detects ASCII control characters in %j',
    (value) => {
      expect(hasAsciiControlCharacters(value)).toBe(true);
    },
  );

  it.each(['', 'plain text', '\u0020', 'кино', '\u0080'])(
    'keeps non-control text unchanged in %j',
    (value) => {
      expect(hasAsciiControlCharacters(value)).toBe(false);
    },
  );
});
