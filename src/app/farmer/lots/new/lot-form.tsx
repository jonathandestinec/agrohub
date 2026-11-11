"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useSyncExternalStore, type FormEvent } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Field, FormError, SubmitButton } from "@/components/auth-ui";
import { Breakdown } from "@/components/lots/breakdown";
import { lotErrorKey } from "@/components/lots/error-key";
import { compressImage } from "@/lib/image-compress";
import { addDays } from "@/lib/lagos-date";
import { formatNaira, toKobo } from "@/lib/money";
import { askDeviation } from "@/modules/board/deviation";
import type { LotFormContext } from "@/modules/catalog/lots";
import { submitLotAction } from "../actions";

const selectClass = "min-h-12 w-full rounded-input bg-step px-4 body-3 text-ink";
const DRAFT_KEY = "agrohub:lot-draft";
const GRADES = ["A", "B", "C", "UNGRADED"] as const;
type DraftField =
  | "cropId"
  | "unitId"
  | "quantity"
  | "grade"
  | "pickupState"
  | "pickupLga"
  | "pickupNote"
  | "ask"
  | "floor"
  | "availableUntil"
  | "note";
type Draft = Partial<Record<DraftField, string>>;

function kobo(value: string): number | null {
  try {
    const amount = toKobo(value.trim().replace(/,/g, ""));
    return amount > 0 ? amount : null;
  } catch {
    return null;
  }
}

// The saved draft as a string: React reads browser storage through useSyncExternalStore,
// so the server render (no storage) and the first client render agree.
function draftSnapshot(): string | null {
  try {
    return window.localStorage.getItem(DRAFT_KEY);
  } catch {
    return null;
  }
}

function subscribeToDraft(onChange: () => void): () => void {
  window.addEventListener("storage", onChange);
  return () => window.removeEventListener("storage", onChange);
}

function parseDraft(raw: string | null): Draft {
  try {
    return raw ? (JSON.parse(raw) as Draft) : {};
  } catch {
    return {};
  }
}

function writeDraft(draft: Draft | null): void {
  try {
    if (draft) window.localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
    else window.localStorage.removeItem(DRAFT_KEY);
  } catch {
    // Private windows and full storage only lose the draft.
  }
}

type Photo = { blob: Blob; url: string };

export function LotForm({ context, states }: { context: LotFormContext; states: string[] }) {
  const t = useTranslations("lots");
  const locale = useLocale();
  const router = useRouter();
  // The unsent fields survive a dropped connection or a trip to ask for a missing crop:
  // defaults, then the saved draft, then this visit's edits.
  const saved = useSyncExternalStore(subscribeToDraft, draftSnapshot, () => null);
  const [edits, setEdits] = useState<Draft>({});
  const values: Draft = useMemo(
    () => ({
      pickupState: context.pickupState,
      pickupLga: context.pickupLga,
      grade: "A",
      availableUntil: addDays(context.today, 14),
      ...parseDraft(saved),
      ...edits,
    }),
    [context, saved, edits],
  );
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [compressing, setCompressing] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function update(name: DraftField, value: string) {
    setEdits((current) => ({ ...current, [name]: value }));
    writeDraft({ ...values, [name]: value });
  }

  async function addPhotos(files: FileList | null) {
    if (!files) return;
    setCompressing(true);
    setError(null);
    try {
      const added: Photo[] = [];
      for (const file of Array.from(files).slice(0, 4 - photos.length)) {
        const blob = await compressImage(file);
        added.push({ blob, url: URL.createObjectURL(blob) });
      }
      setPhotos((current) => [...current, ...added].slice(0, 4));
    } catch {
      setError(t("form.photoFailed"));
    } finally {
      setCompressing(false);
    }
  }

  function removePhoto(index: number) {
    setPhotos((current) => {
      URL.revokeObjectURL(current[index].url);
      return current.filter((_, i) => i !== index);
    });
  }

  const askKobo = kobo(values.ask ?? "");
  const quantity = /^\d{1,7}$/.test(values.quantity ?? "") ? Number(values.quantity) : null;
  const unitName = context.units.find((u) => u.id === values.unitId)?.name ?? "";
  const board = context.boardPrices[`${values.cropId}:${values.unitId}`] ?? [];
  const deviation =
    askKobo !== null ? askDeviation(askKobo, board.map((b) => b.priceKobo), context.priceDeviationBps) : null;
  const warned = deviation === "HIGH" || deviation === "LOW";
  const formatWeek = (key: string) =>
    new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: "UTC" }).format(new Date(`${key}T00:00:00Z`));

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    data.delete("photoPicker");
    photos.forEach((photo, i) => data.append("photos", new File([photo.blob], `photo-${i + 1}.jpg`, { type: "image/jpeg" })));
    setPending(true);
    setError(null);
    const result = await submitLotAction(data);
    setPending(false);
    if (!result.ok) {
      setError(t(lotErrorKey(result.code)));
      return;
    }
    writeDraft(null);
    router.push(`/farmer/lots/${result.data.lotId}`);
  }

  const bind = (name: DraftField) => ({
    name,
    value: values[name] ?? "",
    onChange: (e: { target: { value: string } }) => update(name, e.target.value),
  });

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-6">
      <div className="grid gap-4 md:grid-cols-2">
        <div className="flex flex-col gap-2">
          <label htmlFor="cropId" className="title-4">
            {t("form.crop")}
          </label>
          <select id="cropId" required className={selectClass} {...bind("cropId")}>
            <option value="" disabled>
              {t("form.choose")}
            </option>
            {context.crops.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-2">
          <label htmlFor="unitId" className="title-4">
            {t("form.unit")}
          </label>
          <select id="unitId" required className={selectClass} {...bind("unitId")}>
            <option value="" disabled>
              {t("form.choose")}
            </option>
            {context.units.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
        </div>
      </div>
      <p className="body-6 text-ink-soft">
        <Link href="/farmer/profile#crop-requests" className="underline underline-offset-4">
          {t("form.notListed")}
        </Link>
      </p>

      <div className="grid gap-4 md:grid-cols-2">
        <Field id="quantity" label={t("form.quantity")} hint={t("form.quantityHint")} inputMode="numeric" required {...bind("quantity")} />
        <div className="flex flex-col gap-2">
          <label htmlFor="grade" className="title-4">
            {t("form.grade")}
          </label>
          <select id="grade" required className={selectClass} {...bind("grade")}>
            {GRADES.map((g) => (
              <option key={g} value={g}>
                {t(`grade.${g}`)}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Field id="ask" label={t("form.ask")} hint={t("form.askHint")} inputMode="decimal" required {...bind("ask")} />
        <Field id="floor" label={t("form.floor")} hint={t("form.floorHint")} inputMode="decimal" required {...bind("floor")} />
      </div>

      {warned ? (
        <div role="status" className="flex flex-col gap-2 rounded-inner bg-step p-4 body-3">
          <p>{deviation === "HIGH" ? t("form.warningHigh") : t("form.warningLow")}</p>
          <ul className="body-6 text-ink-soft">
            {board.map((b) => (
              <li key={b.market}>
                {t("form.boardPrice", { market: b.market, price: formatNaira(b.priceKobo), week: formatWeek(b.weekOf) })}
              </li>
            ))}
          </ul>
          <p className="body-6">{t("form.warningNote")}</p>
        </div>
      ) : null}

      {askKobo !== null && quantity !== null && quantity > 0 ? (
        <section className="flex flex-col gap-2">
          <h2 className="title-3">{t("form.breakdownHeading")}</h2>
          <Breakdown
            askKobo={askKobo}
            quantity={quantity}
            cutBps={context.quotedCutBps}
            feeBps={context.platformFeeBps}
            unit={unitName || t("form.unitFallback")}
          />
        </section>
      ) : null}

      <div className="flex flex-col gap-2">
        <label htmlFor="note" className="title-4">
          {warned ? t("form.noteRequired") : t("form.note")}
        </label>
        <textarea
          id="note"
          rows={3}
          maxLength={500}
          required={warned}
          minLength={warned ? 10 : undefined}
          className="w-full rounded-input bg-step px-4 py-3 body-3 text-ink"
          {...bind("note")}
        />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="flex flex-col gap-2">
          <label htmlFor="pickupState" className="title-4">
            {t("form.pickupState")}
          </label>
          <select id="pickupState" required className={selectClass} {...bind("pickupState")}>
            <option value="" disabled>
              {t("form.choose")}
            </option>
            {states.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
        <Field id="pickupLga" label={t("form.pickupLga")} maxLength={80} required {...bind("pickupLga")} />
      </div>
      <Field id="pickupNote" label={t("form.pickupNote")} hint={t("form.pickupNoteHint")} maxLength={120} {...bind("pickupNote")} />
      <Field
        id="availableUntil"
        type="date"
        label={t("form.availableUntil")}
        hint={t("form.availableUntilHint")}
        min={context.today}
        max={addDays(context.today, 90)}
        required
        {...bind("availableUntil")}
      />

      <fieldset className="flex flex-col gap-2">
        <legend className="title-4">{t("form.photos")}</legend>
        <p className="body-6 text-ink-soft">{t("form.photosHint")}</p>
        {photos.length > 0 ? (
          <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {photos.map((photo, i) => (
              <li key={photo.url} className="flex flex-col gap-1">
                {/* eslint-disable-next-line @next/next/no-img-element -- a local preview blob */}
                <img src={photo.url} alt={t("form.photoAlt", { n: i + 1 })} className="aspect-square w-full rounded-inner object-cover" />
                <button type="button" className="min-h-11 body-6 underline" onClick={() => removePhoto(i)}>
                  {t("form.removePhoto")}
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        {photos.length < 4 ? (
          <input
            id="photoPicker"
            name="photoPicker"
            type="file"
            accept="image/jpeg,image/webp,image/*"
            multiple
            aria-label={t("form.addPhotos")}
            disabled={compressing}
            onChange={(e) => {
              void addPhotos(e.target.files);
              e.target.value = "";
            }}
            className="min-h-12 body-6"
          />
        ) : null}
        {compressing ? <p className="body-6 text-ink-soft">{t("form.compressing")}</p> : null}
      </fieldset>

      <FormError message={error} />
      <SubmitButton pending={pending || compressing} label={t("form.submit")} pendingLabel={t("form.submitting")} />
    </form>
  );
}
