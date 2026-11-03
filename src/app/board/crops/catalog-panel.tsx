"use client";

import { useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { FormError, inputClass } from "@/components/auth-ui";
import { Button, Chip } from "@/components/ui";
import type { CatalogItem } from "@/modules/catalog/views";
import {
  addCatalogItemAction,
  renameCatalogItemAction,
  setCatalogItemActiveAction,
} from "../actions";
import { boardErrorKey } from "../error-key";

type Kind = "crop" | "unit";

const COPY = {
  crop: { heading: "cropsHeading", label: "newCrop", add: "addCrop", empty: "emptyCrops" },
  unit: { heading: "unitsHeading", label: "newUnit", add: "addUnit", empty: "emptyUnits" },
} as const;

export function CatalogPanel({ kind, items }: { kind: Kind; items: CatalogItem[] }) {
  const t = useTranslations("board");
  const copy = COPY[kind];
  const [name, setName] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const headingId = `${kind}-heading`;

  async function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    const result = await addCatalogItemAction({ kind, name });
    setPending(false);
    if (result.ok) setName("");
    else setError(t(boardErrorKey(result.code)));
  }

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-4">
      <h2 id={headingId} className="heading-6">
        {t(`crops.${copy.heading}`)}
      </h2>
      <form onSubmit={add} className="flex flex-col gap-2">
        <label htmlFor={`new-${kind}`} className="title-4">
          {t(`crops.${copy.label}`)}
        </label>
        <div className="flex gap-2">
          <input
            id={`new-${kind}`}
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            maxLength={60}
            autoComplete="off"
            className={inputClass}
          />
          <Button type="submit" disabled={pending} size="lg" className="shrink-0">
            {pending ? t("crops.adding") : t(`crops.${copy.add}`)}
          </Button>
        </div>
        <FormError message={error} />
      </form>
      {items.length === 0 ? (
        <p className="body-3 text-ink-soft">{t(`crops.${copy.empty}`)}</p>
      ) : (
        <ul aria-label={t(`crops.${copy.heading}`)} className="flex flex-col gap-2">
          {items.map((item) => (
            <CatalogRow key={item.id} kind={kind} item={item} />
          ))}
        </ul>
      )}
    </section>
  );
}

function CatalogRow({ kind, item }: { kind: Kind; item: CatalogItem }) {
  const t = useTranslations("board");
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(item.name);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function act(work: () => ReturnType<typeof renameCatalogItemAction>) {
    setPending(true);
    setError(null);
    const result = await work();
    setPending(false);
    if (result.ok) setEditing(false);
    else setError(t(boardErrorKey(result.code)));
  }

  async function rename(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await act(() => renameCatalogItemAction({ kind, id: item.id, name }));
  }

  return (
    <li className="flex flex-col gap-2 rounded-inner bg-step p-3">
      {editing ? (
        <form onSubmit={rename} className="flex flex-col gap-2">
          <label htmlFor={`rename-${item.id}`} className="sr-only">
            {t("crops.renameLabel", { name: item.name })}
          </label>
          <input
            id={`rename-${item.id}`}
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            maxLength={60}
            autoComplete="off"
            className={inputClass.replace("bg-step", "bg-paper")}
          />
          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={pending}>
              {t("crops.saveName")}
            </Button>
            <Button
              tone="paper"
              onClick={() => {
                setEditing(false);
                setName(item.name);
                setError(null);
              }}
            >
              {t("crops.cancel")}
            </Button>
          </div>
        </form>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="flex min-w-0 items-center gap-2">
            <span className="title-4 break-words">{item.name}</span>
            {item.active ? null : <Chip tone="paper">{t("crops.hidden")}</Chip>}
          </span>
          <span className="flex gap-2">
            <Button tone="paper" disabled={pending} onClick={() => setEditing(true)}>
              {t("crops.rename")}
            </Button>
            <Button
              tone="paper"
              disabled={pending}
              onClick={() =>
                act(() => setCatalogItemActiveAction({ kind, id: item.id, active: !item.active }))
              }
            >
              {item.active ? t("crops.hide") : t("crops.show")}
            </Button>
          </span>
        </div>
      )}
      <FormError message={error} />
    </li>
  );
}
