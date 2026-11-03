// Digits of a one-time code as typed or pasted ("123 456", "12-34-56"), cut to the code length.
export function otpDigits(raw: string, length: number): string {
  return raw.replace(/\D/g, "").slice(0, length);
}
