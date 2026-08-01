// Detects the ASCII controls forbidden at API input and upstream header boundaries.
// Находит ASCII control characters, запрещённые на границах API input и upstream headers.
export function hasAsciiControlCharacters(value: string): boolean {
  return Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0);
    return codePoint !== undefined && (codePoint <= 31 || codePoint === 127);
  });
}
