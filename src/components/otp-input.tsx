"use client";

import { useState } from "react";
import { otpDigits } from "@/lib/otp";

// A one-time-code field drawn as digit slots. One real <input> sits over the slots, so
// paste, SMS/password-manager autofill (autocomplete="one-time-code"), labels and form
// submission all behave like a plain input; the slots are only its picture.
export function OtpInput({
  id,
  name,
  label,
  length = 6,
  invalid = false,
  shakeKey = 0,
}: {
  id: string;
  name: string;
  label: string;
  length?: number;
  invalid?: boolean;
  // Bump to replay the shake after a refused code.
  shakeKey?: number;
}) {
  const [value, setValue] = useState("");
  const [focused, setFocused] = useState(false);
  const active = Math.min(value.length, length - 1);
  const half = Math.ceil(length / 2);

  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className="title-4">
        {label}
      </label>
      <div
        key={shakeKey}
        className={`relative flex items-center gap-2 ${invalid && shakeKey > 0 ? "otp-shake" : ""}`}
      >
        {Array.from({ length }, (_, i) => {
          const digit = value[i];
          const isActive = focused && i === active && !(i === length - 1 && digit);
          const state = invalid
            ? "outline-2 outline-bad"
            : isActive
              ? "outline-2 outline-ink -translate-y-0.5"
              : digit
                ? "bg-paper outline-1 outline-step-deep"
                : "";
          return (
            <div key={i} aria-hidden className="contents">
              {i === half ? <span className="h-0.5 w-2 shrink-0 rounded-full bg-step-deep" /> : null}
              <div
                className={`flex h-14 min-w-0 flex-1 items-center justify-center rounded-input bg-step font-mono heading-6 text-ink outline-offset-2 transition-[background-color,outline-color,transform] duration-200 ease-(--ease) ${state}`}
              >
                {digit ? (
                  <span key={`${i}-${digit}`} className="otp-pop">
                    {digit}
                  </span>
                ) : isActive ? (
                  <span className="otp-caret h-6 w-0.5 rounded-full bg-ink" />
                ) : null}
              </div>
            </div>
          );
        })}
        <input
          id={id}
          name={name}
          value={value}
          onChange={(event) => setValue(otpDigits(event.target.value, length))}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern={`\\d{${length}}`}
          maxLength={length}
          required
          aria-invalid={invalid || undefined}
          spellCheck={false}
          className="absolute inset-0 h-full w-full cursor-text bg-transparent body-3 opacity-0 outline-none"
        />
      </div>
    </div>
  );
}
