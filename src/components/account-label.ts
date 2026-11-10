// Pure: the first word of a person's name, for the account button.
export function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? "";
}

// Pure: capitals of the first and last words, for the account button on narrow screens.
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  const first = words[0][0];
  const last = words.length > 1 ? words[words.length - 1][0] : "";
  return `${first}${last}`.toUpperCase();
}
