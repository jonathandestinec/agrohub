// Pure: where focus goes inside an open menu for a key. `index` is the item holding focus
// (-1 when focus is on the menu's button); the result is the item to focus, or null when the
// key is not the menu's to handle. Arrow keys wrap round the ends.
export function menuStep(key: string, index: number, count: number): number | null {
  if (count <= 0) return null;
  switch (key) {
    case "ArrowDown":
      return index < 0 || index >= count - 1 ? 0 : index + 1;
    case "ArrowUp":
      return index <= 0 ? count - 1 : index - 1;
    case "Home":
      return 0;
    case "End":
      return count - 1;
    default:
      return null;
  }
}
