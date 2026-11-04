import { amountsIn, lineTotalKobo, thousandsIn, withinBps } from "@/lib/money";

// A Nigerian phone number: +234 or 234 or a leading 0 (optionally in brackets), then 7, 8 or 9,
// then 0 or 1, then eight digits, with spaces, dashes, dots or brackets between digits.
const PHONE = /(?:\+?234|(?<!\d)\(?0)[\s().-]*[789][\s().-]*[01](?:[\s().-]*\d){8}(?!\d)/;
const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;

// An amount in thousands ("55k") names a price if it is within 1% of it.
const THOUSANDS_TOLERANCE_BPS = 100;

// Pure: whether text shares a phone number or an email address. Messages never may (spec 6.5).
export function hasContactDetails(text: string): boolean {
  return PHONE.test(text) || EMAIL.test(text);
}

// Pure: whether text names this amount (in kobo): as naira or plain kobo, roughly in thousands
// ("43k"), or as the line total for any of the given quantities.
export function mentionsAmount(text: string, kobo: number, quantities: number[] = []): boolean {
  const targets = [kobo, ...quantities.filter((q) => q > 1).map((q) => lineTotalKobo(kobo, q))];
  const exact = amountsIn(text);
  const rough = thousandsIn(text);
  return targets.some(
    (target) => exact.includes(target) || rough.some((amount) => withinBps(amount, target, THOUSANDS_TOLERANCE_BPS)),
  );
}
