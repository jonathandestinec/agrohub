export const locales = ["en", "pcm", "ha", "yo", "ig"] as const;

export type Locale = (typeof locales)[number];

export const defaultLocale: Locale = "en";

// A language is added here only after a native speaker has reviewed its
// messages file. An unreviewed language must never be served.
export const enabledLocales: Locale[] = ["en"];

// Exact, case-sensitive match against the enabled list; anything else is English.
export function resolveLocale(
  input: string | undefined,
  enabled: readonly Locale[] = enabledLocales,
): Locale {
  const match = enabled.find((locale) => locale === input);
  return match ?? defaultLocale;
}
