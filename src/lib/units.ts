// Catalog units only have one name ("Bag", "100kg bag", "kg"), so the plural is a rule:
// lowercase it, keep it for exactly 1, leave measure symbols alone, and add an ending to the last word.
const SYMBOLS = new Set(["kg", "g", "t", "l", "ml", "lb", "lbs"]);

export function unitLabel(unit: string, quantity: number): string {
  const name = unit.trim().toLowerCase();
  if (!name || quantity === 1) return name;
  const words = name.split(/\s+/);
  const last = words[words.length - 1];
  if (SYMBOLS.has(last)) return name;
  let plural = last;
  if (/(s|x|z|ch|sh)$/.test(last)) plural = /ss$|x$|z$|ch$|sh$/.test(last) ? `${last}es` : last;
  else if (/[^aeiou]y$/.test(last)) plural = `${last.slice(0, -1)}ies`;
  else plural = `${last}s`;
  words[words.length - 1] = plural;
  return words.join(" ");
}
