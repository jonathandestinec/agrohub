"use client";

import { useTranslations } from "next-intl";

type Crop = { id: string; name: string };

// Checkboxes for the board's active crops, posted as repeated `cropIds` fields. Choosing
// none is allowed, so an empty crop list never blocks a farmer.
export function CropPicker({ crops, chosen = [] }: { crops: Crop[]; chosen?: string[] }) {
  const t = useTranslations("farmer.profile");
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="title-4">{t("crops")}</legend>
      {crops.length === 0 ? (
        <p className="body-6 text-ink-soft">{t("cropsEmpty")}</p>
      ) : (
        <>
          <p className="body-6 text-ink-soft">{t("cropsHint")}</p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {crops.map((crop) => (
              <label
                key={crop.id}
                className="flex min-h-11 cursor-pointer items-center gap-3 rounded-input bg-step px-4 body-3"
              >
                <input
                  type="checkbox"
                  name="cropIds"
                  value={crop.id}
                  defaultChecked={chosen.includes(crop.id)}
                  className="size-5 accent-forest"
                />
                <span className="break-words">{crop.name}</span>
              </label>
            ))}
          </div>
        </>
      )}
    </fieldset>
  );
}
