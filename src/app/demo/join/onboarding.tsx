"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { STATES } from "@/modules/geo/states";
import { ArrowRight, Button, ButtonLink, Check } from "../_components/ui";
import { CROPS, cooperativeById } from "../_lib/data";

// Demo of spec 6.2: a farmer opens an officer's invite link, creates an account with
// consent, confirms their phone (falling back to email), describes their farm, adds a
// bank account by Paystack recipient, then waits for the officer's approval.

const COOP = cooperativeById("ogbomoso");
const OFFICER = "Tunde Adeleke";
const BANKS = ["Access Bank", "First Bank of Nigeria", "GTBank", "Moniepoint MFB", "OPay", "UBA", "Wema Bank", "Zenith Bank"];

type StepId = "invite" | "account" | "phone" | "farm" | "bank" | "done";
const STEPS: { id: StepId; label: string; photo: string; alt: string; caption: string }[] = [
  { id: "invite", label: "Invite", photo: "/demo/cooperative.jpg", alt: "Members of a farmer cooperative seated together at a meeting", caption: "One cooperative, one catalogue, one fair price." },
  { id: "account", label: "Account", photo: "/demo/farmer-at-harvest.jpg", alt: "A farmer carrying harvested rice across a paddy field", caption: "Your email is your login. Your phone stays private." },
  { id: "phone", label: "Phone", photo: "/demo/maize.jpg", alt: "Farmers carrying harvested maize stalks past a field", caption: "Only AgroHub admins can see your number." },
  { id: "farm", label: "Farm", photo: "/demo/rice.jpg", alt: "Rice paddies seen from the air", caption: "Your officer sees this before approving you." },
  { id: "bank", label: "Bank", photo: "/demo/sorghum.jpg", alt: "Bags of grain at a market", caption: "Your share of every sale lands here." },
  { id: "done", label: "Approval", photo: "/demo/tomatoes.jpg", alt: "Tomatoes laid out for sale at a market", caption: "Next: list your first harvest." },
];

type Form = {
  name: string;
  email: string;
  phone: string;
  password: string;
  consent: boolean;
  code: string;
  phoneConfirmed: boolean;
  farmSize: string;
  crops: string[];
  state: string;
  lga: string;
  bank: string;
  account: string;
  accountName: string;
};

const START: Form = {
  name: "",
  email: "",
  phone: "",
  password: "",
  consent: false,
  code: "",
  phoneConfirmed: false,
  farmSize: "",
  crops: [],
  state: "Oyo",
  lga: "",
  bank: "",
  account: "",
  accountName: "",
};

type Errors = Partial<Record<keyof Form, string>>;

function validate(step: StepId, f: Form): Errors {
  const e: Errors = {};
  if (step === "account") {
    if (f.name.trim().split(/\s+/).length < 2) e.name = "Enter your first and last name, as on your bank account.";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email.trim())) e.email = "Enter an email address, for example ade@gmail.com.";
    if (!/^(\+?234|0)[789][01]\d{8}$/.test(f.phone.replace(/\s/g, ""))) e.phone = "Enter a Nigerian mobile number, for example 0803 123 4567.";
    if (f.password.length < 8) e.password = "Use at least 8 characters.";
    if (!f.consent) e.consent = "Please accept the privacy notice to continue.";
  }
  if (step === "phone" && !f.phoneConfirmed && !/^\d{6}$/.test(f.code)) e.code = "Enter the 6-digit code from the text message.";
  if (step === "farm") {
    if (!/^\d{1,6}(\.\d{1,2})?$/.test(f.farmSize.trim()) || /^0+(\.0+)?$/.test(f.farmSize.trim())) e.farmSize = "Enter your farm size in hectares, for example 2.5.";
    if (f.crops.length === 0) e.crops = "Choose at least one crop.";
    if (!f.lga.trim()) e.lga = "Enter your local government area.";
  }
  if (step === "bank") {
    if (!f.bank) e.bank = "Choose your bank.";
    if (!/^\d{10}$/.test(f.account)) e.account = "Enter the 10-digit account number.";
    else if (!f.accountName) e.account = "Wait for the account check to finish.";
  }
  return e;
}

export function Onboarding() {
  const [index, setIndex] = useState(0);
  const [dir, setDir] = useState<"fwd" | "back">("fwd");
  const [form, setForm] = useState<Form>(START);
  const [errors, setErrors] = useState<Errors>({});
  const [checking, setChecking] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const step = STEPS[index]!;
  const set = <K extends keyof Form>(k: K, v: Form[K]) => {
    setForm((f) => ({ ...f, [k]: v }));
    setErrors((e) => ({ ...e, [k]: undefined }));
  };

  // Move focus to the new step's heading so keyboard and screen reader users follow along.
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const heading = headingRef.current;
    if (!heading) return;
    heading.focus({ preventScroll: true });
    const top = heading.getBoundingClientRect().top;
    if (top < 0 || top > window.innerHeight * 0.6) {
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      window.scrollTo({ top: window.scrollY + top - 96, behavior: reduce ? "auto" : "smooth" });
    }
  }, [index]);

  // Paystack resolves the account name; the demo derives it from the name typed earlier.
  useEffect(() => {
    if (!form.bank || !/^\d{10}$/.test(form.account)) return;
    const t1 = setTimeout(() => setChecking(true), 0);
    const t2 = setTimeout(() => {
      setForm((f) => ({ ...f, accountName: (f.name.trim() || "Adebayo Ogunleye").toUpperCase() }));
      setChecking(false);
    }, 1300);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [form.bank, form.account]);

  function next() {
    const e = validate(step.id, form);
    setErrors(e);
    if (Object.keys(e).length > 0) return;
    setDir("fwd");
    setIndex((i) => Math.min(i + 1, STEPS.length - 1));
  }

  function back() {
    setErrors({});
    setDir("back");
    setIndex((i) => Math.max(i - 1, 0));
  }

  const firstName = form.name.trim().split(/\s+/)[0] || "Adebayo";

  return (
    <div className="grid gap-2 lg:grid-cols-12 lg:gap-3">
      <PhotoPanel index={index} />

      <section className="flex min-h-[640px] flex-col rounded-3xl bg-[var(--d-step)] p-5 md:p-10 lg:col-span-7" aria-labelledby="onboarding-heading">
        <Progress index={index} />

        <div key={step.id} className={`mt-10 flex flex-1 flex-col ${dir === "fwd" ? "step-in" : "step-in-back"}`}>
          {step.id === "invite" ? (
            <Stage
              headingRef={headingRef}
              title={`Join ${COOP.name}`}
              lead={`${OFFICER}, an officer of the cooperative, invited you. Members sell their harvests together to bulk buyers on AgroHub.`}
            >
              <ul className="stagger flex flex-col gap-2">
                {[
                  ["Verified by AgroHub", `Registration documents checked on ${COOP.verifiedOn}.`],
                  ["You see your earnings first", "Every lot shows your take home before you agree to sell."],
                  ["Paid straight to your bank", "Buyers pay upfront. Your share is released when they confirm delivery."],
                ].map(([t, b]) => (
                  <li key={t} className="flex gap-4 rounded-2xl bg-[var(--d-paper)] p-4">
                    <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-[var(--d-lime)] text-[var(--d-lime-ink)]">
                      <Check />
                    </span>
                    <span>
                      <span className="block title-3">{t}</span>
                      <span className="block body-6 text-[var(--d-ink-2)]">{b}</span>
                    </span>
                  </li>
                ))}
              </ul>
              <p className="mt-6 caption-2 text-[var(--d-ink-2)]">
                {COOP.members} members · {COOP.lga}, {COOP.state}. A farmer can belong to one cooperative at a time.
              </p>
            </Stage>
          ) : null}

          {step.id === "account" ? (
            <Stage headingRef={headingRef} title="Create your account" lead="Use the name on your bank account, so your payouts are not held up.">
              <div className="stagger grid gap-4 md:grid-cols-2">
                <Field id="name" label="Full name" value={form.name} onChange={(v) => set("name", v)} error={errors.name} autoComplete="name" className="md:col-span-2" />
                <Field id="email" label="Email address" type="email" value={form.email} onChange={(v) => set("email", v)} error={errors.email} autoComplete="email" hint="You will sign in with this." />
                <Field id="phone" label="Phone number" type="tel" value={form.phone} onChange={(v) => set("phone", v)} error={errors.phone} autoComplete="tel" hint="Seen only by AgroHub admins." />
                <Field id="password" label="Password" type="password" value={form.password} onChange={(v) => set("password", v)} error={errors.password} autoComplete="new-password" hint="At least 8 characters." className="md:col-span-2" />
                <Consent checked={form.consent} onChange={(v) => set("consent", v)} error={errors.consent} />
              </div>
            </Stage>
          ) : null}

          {step.id === "phone" ? (
            <Stage headingRef={headingRef} title="Confirm your phone" lead={`We sent a 6-digit code to ${form.phone || "your phone"}. In this demo, any 6 digits work.`}>
              {form.phoneConfirmed ? (
                <p role="status" className="step-in flex items-center gap-3 rounded-2xl bg-[var(--d-paper)] p-4 body-5">
                  <Check className="size-5 text-[var(--d-good)]" /> No problem. We emailed {form.email || "you"} a confirmation link instead, and your phone is noted as unconfirmed.
                </p>
              ) : (
                <div className="stagger flex flex-col gap-4">
                  <CodeInput value={form.code} onChange={(v) => set("code", v)} error={errors.code} />
                  <button type="button" onClick={() => set("phoneConfirmed", true)} className="press self-start rounded-full px-1 body-5 text-[var(--d-ink-2)] underline underline-offset-4 hover:text-[var(--d-ink)]">
                    The text did not arrive. Confirm by email instead.
                  </button>
                </div>
              )}
            </Stage>
          ) : null}

          {step.id === "farm" ? (
            <Stage headingRef={headingRef} title="Tell us about your farm" lead={`${OFFICER} sees this before approving you.`}>
              <div className="stagger flex flex-col gap-5">
                <div className="grid gap-4 md:grid-cols-3">
                  <Field id="farmSize" label="Farm size (hectares)" inputMode="decimal" value={form.farmSize} onChange={(v) => set("farmSize", v)} error={errors.farmSize} hint="For example 2.5" />
                  <div className="flex flex-col gap-2">
                    <label htmlFor="state" className="title-4">State</label>
                    <select id="state" value={form.state} onChange={(e) => set("state", e.target.value)} className={INPUT}>
                      {STATES.map((s) => <option key={s}>{s}</option>)}
                    </select>
                  </div>
                  <Field id="lga" label="Local government area" value={form.lga} onChange={(v) => set("lga", v)} error={errors.lga} />
                </div>
                <fieldset aria-describedby={errors.crops ? "crops-error" : undefined}>
                  <legend className="title-4">Crops you grow</legend>
                  <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
                    {CROPS.map((c) => {
                      const on = form.crops.includes(c.id);
                      return (
                        <button
                          key={c.id}
                          type="button"
                          aria-pressed={on}
                          onClick={() => set("crops", on ? form.crops.filter((x) => x !== c.id) : [...form.crops, c.id])}
                          className={`press group relative isolate flex h-24 items-end overflow-hidden rounded-2xl p-3 text-left text-white outline-offset-2 focus-visible:outline-2 focus-visible:outline-[var(--d-ink)] ${on ? "ring-4 ring-[var(--d-lime)]" : ""}`}
                        >
                          <Image src={c.photo} alt="" fill sizes="200px" className={`-z-10 object-cover transition-transform duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] ${on ? "scale-110" : "group-hover:scale-105"}`} />
                          <span aria-hidden="true" className={`absolute inset-0 -z-10 transition-colors duration-300 ${on ? "bg-black/35" : "bg-black/50"}`} />
                          <span className="title-3">{c.name}</span>
                          <span
                            aria-hidden="true"
                            className={`absolute right-2 top-2 flex size-7 items-center justify-center rounded-full bg-[var(--d-lime)] text-[var(--d-lime-ink)] transition-[opacity,transform] duration-300 ease-[cubic-bezier(0.23,1,0.32,1)] ${on ? "scale-100 opacity-100" : "scale-75 opacity-0"}`}
                          >
                            <Check />
                          </span>
                        </button>
                      );
                    })}
                  </div>
                  {errors.crops ? <p id="crops-error" className="mt-2 body-5 text-[var(--d-bad)]">{errors.crops}</p> : null}
                </fieldset>
              </div>
            </Stage>
          ) : null}

          {step.id === "bank" ? (
            <Stage headingRef={headingRef} title="Where should we pay you?" lead="AgroHub never stores your account number. Paystack keeps it and gives us a reference to pay into.">
              <div className="stagger flex flex-col gap-4">
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="flex flex-col gap-2">
                    <label htmlFor="bank" className="title-4">Bank</label>
                    <select
                      id="bank"
                      value={form.bank}
                      onChange={(e) => { set("bank", e.target.value); set("accountName", ""); }}
                      aria-invalid={!!errors.bank}
                      aria-describedby={errors.bank ? "bank-error" : undefined}
                      className={INPUT}
                    >
                      <option value="">Choose a bank</option>
                      {BANKS.map((b) => <option key={b}>{b}</option>)}
                    </select>
                    {errors.bank ? <p id="bank-error" className="body-5 text-[var(--d-bad)]">{errors.bank}</p> : null}
                  </div>
                  <Field
                    id="account"
                    label="Account number"
                    inputMode="numeric"
                    maxLength={10}
                    value={form.account}
                    onChange={(v) => { set("account", v.replace(/\D/g, "")); set("accountName", ""); }}
                    error={errors.account}
                    hint="The 10-digit account number"
                  />
                </div>
                <div aria-live="polite" className="min-h-20">
                  {checking ? (
                    <div className="flex items-center gap-4 rounded-2xl bg-[var(--d-paper)] p-4" aria-label="Checking the account">
                      <span className="size-10 animate-pulse rounded-full bg-[var(--d-step-2)]" />
                      <span className="flex flex-col gap-2">
                        <span className="h-3 w-40 animate-pulse rounded-full bg-[var(--d-step-2)]" />
                        <span className="h-3 w-24 animate-pulse rounded-full bg-[var(--d-step-2)]" />
                      </span>
                    </div>
                  ) : form.accountName ? (
                    <div className="step-in flex items-center gap-4 rounded-2xl bg-[var(--d-paper)] p-4">
                      <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-[var(--d-forest)] text-[var(--d-forest-ink)]"><Check /></span>
                      <span>
                        <span className="block title-3">{form.accountName}</span>
                        <span className="block body-6 text-[var(--d-good)]">Matches the name on your AgroHub account</span>
                      </span>
                    </div>
                  ) : null}
                </div>
              </div>
            </Stage>
          ) : null}

          {step.id === "done" ? (
            <Stage headingRef={headingRef} title={`You're in line, ${firstName}`} lead={`${OFFICER} has been told you want to join. You will get an email as soon as you are approved.`}>
              <div className="flex flex-col gap-6">
                <svg viewBox="0 0 96 96" className="size-24" aria-hidden="true">
                  <circle cx="48" cy="48" r="44" className="draw-ring" fill="none" stroke="var(--d-forest)" strokeWidth="6" />
                  <path d="M30 49.5 43 62l24-27" className="draw-check" fill="none" stroke="var(--d-forest)" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                <ol className="stagger flex flex-col gap-2">
                  {[
                    ["Account created", form.email || "Email confirmed"],
                    ["Phone", form.phoneConfirmed ? "Confirmed by email instead" : "Confirmed"],
                    ["Farm profile", `${form.farmSize || "2.5"} hectares · ${form.crops.length ? form.crops.map((c) => CROPS.find((x) => x.id === c)?.name).join(", ") : "Maize"}`],
                    ["Bank account", form.accountName ? `${form.accountName} · ${form.bank}` : "Saved"],
                  ].map(([t, b]) => (
                    <li key={t} className="flex items-center gap-4 rounded-2xl bg-[var(--d-paper)] p-4">
                      <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-[var(--d-forest)] text-[var(--d-forest-ink)]"><Check /></span>
                      <span>
                        <span className="block title-3">{t}</span>
                        <span className="block body-6 text-[var(--d-ink-2)]">{b}</span>
                      </span>
                    </li>
                  ))}
                  <li className="flex items-center gap-4 rounded-2xl bg-[var(--d-lime)] p-4 text-[var(--d-lime-ink)]">
                    <span className="relative flex size-8 shrink-0 items-center justify-center">
                      <span className="pulse-dot absolute inset-0 rounded-full bg-[var(--d-forest)]/25" />
                      <span className="size-3 rounded-full bg-[var(--d-forest)]" />
                    </span>
                    <span>
                      <span className="block title-3">Officer approval</span>
                      <span className="block body-6">Waiting for {OFFICER}. Most officers reply within a day.</span>
                    </span>
                  </li>
                </ol>
              </div>
            </Stage>
          ) : null}
        </div>

        <div className="mt-10 flex items-center justify-between gap-3">
          {index > 0 && step.id !== "done" ? (
            <Button tone="paper" onClick={back}>Back</Button>
          ) : <span />}
          {step.id === "done" ? (
            <ButtonLink href="/demo/farmer" className="min-h-12 pr-2">
              Preview your farmer page
              <span className="flex size-8 items-center justify-center rounded-full bg-[var(--d-lime)] text-[var(--d-lime-ink)]"><ArrowRight /></span>
            </ButtonLink>
          ) : (
            <Button onClick={next} disabled={step.id === "bank" && checking} className="min-h-12 pr-2">
              {step.id === "invite" ? "Join this cooperative" : step.id === "bank" ? "Finish" : "Continue"}
              <span className="flex size-8 items-center justify-center rounded-full bg-[var(--d-lime)] text-[var(--d-lime-ink)]"><ArrowRight /></span>
            </Button>
          )}
        </div>
      </section>
    </div>
  );
}

const INPUT =
  "min-h-12 w-full rounded-xl bg-[var(--d-paper)] px-4 body-3 text-[var(--d-ink)] outline-offset-2 transition-[outline-color] focus-visible:outline-2 focus-visible:outline-[var(--d-ink)] aria-[invalid=true]:outline-2 aria-[invalid=true]:outline-[var(--d-bad)]";

function Stage({
  title,
  lead,
  headingRef,
  children,
}: {
  title: string;
  lead: string;
  headingRef: React.RefObject<HTMLHeadingElement | null>;
  children: ReactNode;
}) {
  return (
    <>
      <h1 id="onboarding-heading" ref={headingRef} tabIndex={-1} className="max-w-[560px] heading-3 outline-none">
        {title}
      </h1>
      <p className="mt-3 max-w-[560px] body-3 text-[var(--d-ink-2)]">{lead}</p>
      <div className="mt-8">{children}</div>
    </>
  );
}

function Field({
  id,
  label,
  value,
  onChange,
  error,
  hint,
  className = "",
  ...input
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  error?: string;
  hint?: string;
  className?: string;
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, "onChange" | "value" | "id">) {
  const uid = useId();
  const describedBy = error ? `${uid}-error` : hint ? `${uid}-hint` : undefined;
  return (
    <div className={`flex flex-col gap-2 ${className}`}>
      <label htmlFor={`${uid}-${id}`} className="title-4">{label}</label>
      <input
        id={`${uid}-${id}`}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={!!error}
        aria-describedby={describedBy}
        className={INPUT}
        {...input}
      />
      {error ? (
        <p id={`${uid}-error`} className="body-5 text-[var(--d-bad)]">{error}</p>
      ) : hint ? (
        <p id={`${uid}-hint`} className="caption-2 text-[var(--d-ink-2)]">{hint}</p>
      ) : null}
    </div>
  );
}

function Consent({ checked, onChange, error }: { checked: boolean; onChange: (v: boolean) => void; error?: string }) {
  return (
    <div className="md:col-span-2">
      <label className="flex cursor-pointer items-start gap-3 rounded-2xl bg-[var(--d-paper)] p-4">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          aria-invalid={!!error}
          aria-labelledby="consent-text"
          aria-describedby={error ? "consent-error" : undefined}
          className="mt-0.5 size-5 shrink-0 accent-[var(--d-forest)]"
        />
        <span id="consent-text" className="body-6">
          I have read and accept the{" "}
          <Link href="/privacy" target="_blank" className="underline underline-offset-2">privacy notice</Link>. AgroHub keeps my details
          under the Nigeria Data Protection Act and deletes them if I ask.
        </span>
      </label>
      {error ? <p id="consent-error" className="mt-2 body-5 text-[var(--d-bad)]">{error}</p> : null}
    </div>
  );
}

function CodeInput({ value, onChange, error }: { value: string; onChange: (v: string) => void; error?: string }) {
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  const digits = Array.from({ length: 6 }, (_, i) => value[i] ?? "");
  function put(i: number, raw: string) {
    const clean = raw.replace(/\D/g, "");
    if (!clean) return;
    const next = (value.slice(0, i) + clean + value.slice(i + clean.length)).slice(0, 6);
    onChange(next);
    refs.current[Math.min(i + clean.length, 5)]?.focus();
  }
  return (
    <div>
      <div className="flex gap-2" role="group" aria-label="6-digit code" aria-describedby={error ? "code-error" : undefined}>
        {digits.map((d, i) => (
          <input
            key={i}
            ref={(el) => { refs.current[i] = el; }}
            inputMode="numeric"
            autoComplete={i === 0 ? "one-time-code" : "off"}
            aria-label={`Digit ${i + 1}`}
            value={d}
            onChange={(e) => put(i, e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Backspace" && !d && i > 0) {
                onChange(value.slice(0, i - 1));
                refs.current[i - 1]?.focus();
              }
            }}
            onPaste={(e) => { e.preventDefault(); put(i, e.clipboardData.getData("text")); }}
            className={`size-12 rounded-xl bg-[var(--d-paper)] text-center heading-5 outline-offset-2 transition-transform duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] focus-visible:outline-2 focus-visible:outline-[var(--d-ink)] md:size-14 ${d ? "scale-[1.04]" : ""} ${error ? "outline-2 outline-[var(--d-bad)]" : ""}`}
          />
        ))}
      </div>
      {error ? <p id="code-error" className="mt-2 body-5 text-[var(--d-bad)]">{error}</p> : null}
    </div>
  );
}

function Progress({ index }: { index: number }) {
  const labels = STEPS.slice(1).map((s) => s.label);
  const done = Math.max(0, index - 1);
  const total = labels.length;
  return (
    <div>
      <div className="h-1.5 overflow-hidden rounded-full bg-[var(--d-step-2)]" role="progressbar" aria-label="Joining progress" aria-valuemin={0} aria-valuemax={total} aria-valuenow={index === 0 ? 0 : Math.min(index, total)}>
        <div
          className="h-full origin-left rounded-full bg-[var(--d-forest)] transition-transform duration-700 ease-[cubic-bezier(0.22,1,0.36,1)]"
          // The last stretch, the officer's approval, stays open until the officer acts.
          style={{ transform: `scaleX(${index === 0 ? 0.02 : Math.min(index, total - 0.4) / total})` }}
        />
      </div>
      <ol className="mt-3 hidden gap-2 sm:flex" aria-hidden="true">
        {labels.map((l, i) => (
          <li
            key={l}
            className={`flex-1 caption-4 transition-colors duration-300 ${i < done ? "text-[var(--d-good)]" : i === done && index > 0 ? "text-[var(--d-ink)]" : "text-[var(--d-ink-2)]/60"}`}
          >
            {l}
          </li>
        ))}
      </ol>
    </div>
  );
}

function PhotoPanel({ index }: { index: number }) {
  const step = STEPS[index]!;
  return (
    <div className="relative h-56 overflow-hidden rounded-3xl bg-[var(--d-forest)] md:h-72 lg:col-span-5 lg:h-auto lg:min-h-[640px]">
      {STEPS.map((s, i) => (
        <div
          key={s.id}
          aria-hidden={i !== index}
          className="absolute inset-0 transition-[opacity,transform] duration-[900ms] ease-[cubic-bezier(0.22,1,0.36,1)]"
          style={{ opacity: i === index ? 1 : 0, transform: i === index ? "scale(1)" : "scale(1.06)" }}
        >
          <Image src={s.photo} alt={i === index ? s.alt : ""} fill sizes="(min-width: 1024px) 40vw, 100vw" priority={i === 0} className="object-cover" />
        </div>
      ))}
      <span aria-hidden="true" className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/10 to-transparent" />

      {/* Top-left notch with the cooperative badge, like the landing hero. */}
      <div className="absolute left-0 top-0 rounded-br-3xl bg-[var(--d-paper)] pb-2 pr-2 lg:pb-3 lg:pr-3">
        <div className="flex items-center gap-3 rounded-2xl bg-[var(--d-step)] p-2 pr-4 lg:p-3 lg:pr-4">
          <span className="relative size-9 shrink-0 overflow-hidden rounded-xl lg:size-10">
            <Image src="/demo/cooperative.jpg" alt="" fill sizes="40px" className="object-cover" />
          </span>
          <span>
            <span className="block title-4">{COOP.name.replace(" Cooperative", "")}</span>
            <span className="flex items-center gap-1 caption-4 text-[var(--d-good)]"><Check className="size-3.5" /> Verified cooperative</span>
          </span>
        </div>
        <span className="notch-corner left-full top-0" data-at="br" />
        <span className="notch-corner left-0 top-full" data-at="br" />
      </div>

      <p key={step.id} className="caption-in absolute bottom-5 left-5 right-5 max-w-sm heading-6 text-white md:bottom-8 md:left-8 lg:text-2xl lg:leading-8">
        {step.caption}
      </p>
    </div>
  );
}
