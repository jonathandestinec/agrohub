import { amountsIn } from "@/lib/money";

// A Nigerian phone number: +234 or 234 or a leading 0, then 7, 8 or 9, then 0 or 1, then eight
// digits, with any spaces or dashes between digits.
const PHONE = /(?:\+?234|(?<!\d)0)[\s-]*[789][\s-]*[01](?:[\s-]*\d){8}(?!\d)/;
const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;

// Pure: whether text shares a phone number or an email address. Messages never may (spec 6.5).
export function hasContactDetails(text: string): boolean {
  return PHONE.test(text) || EMAIL.test(text);
}

// Pure: whether text names this amount (in kobo) as naira or as plain kobo.
export function mentionsAmount(text: string, kobo: number): boolean {
  return amountsIn(text).includes(kobo);
}
