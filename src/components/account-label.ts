// Whole letters, so an accent or a dot below stays with its letter (Yoruba names carry both).
function letters(word: string): string[] {
  if (typeof Intl !== "undefined" && "Segmenter" in Intl) {
    return Array.from(new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(word), (s) => s.segment);
  }
  return Array.from(word);
}

// Pure: the capitals shown in the account circle. The first letters of the first and last
// words of the name; for a one-word name its first two letters; "?" for a blank name.
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  const chosen =
    words.length > 1
      ? [letters(words[0])[0], letters(words[words.length - 1])[0]]
      : letters(words[0]).slice(0, 2);
  return chosen.join("").toLocaleUpperCase();
}
