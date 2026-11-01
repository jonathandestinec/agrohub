// The ?next= return path after sign-in or sign-up. Only a same-site relative path is kept:
// it must start with "/", and "//" or "/\" (which browsers treat as another host) are
// refused. Backslashes and control characters are refused anywhere, since browsers strip
// or rewrite them ("/\t/evil" becomes "//evil"). Anything else returns "/".
export function safeNext(value: unknown): string {
  if (typeof value !== "string") return "/";
  if (!value.startsWith("/") || value.startsWith("//")) return "/";
  if (value.includes("\\")) return "/";
  if (/[\u0000-\u001f\u007f]/.test(value)) return "/";
  return value;
}

// A link to path that carries a checked next; "/" is the default, so it is left off.
export function withNext(path: string, next: string): string {
  const target = safeNext(next);
  return target === "/" ? path : `${path}?next=${encodeURIComponent(target)}`;
}
