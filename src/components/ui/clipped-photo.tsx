import Image from "next/image";
import { Mark } from "./icons";
import { PHOTOS, type PhotoKey } from "./photo-credits";

// The demo's signature: a photo panel with a frame-coloured notch cut from its top-left
// corner, joined by concave corners (.notch-corner), and a dark scrim under the caption.
// Lazy-loaded; callers keep it inside a `hidden md:block` column so phones never fetch it.
export function ClippedPhoto({ photo, caption }: { photo: PhotoKey; caption: string }) {
  const { src, alt } = PHOTOS[photo];
  return (
    <div className="relative isolate h-full min-h-[560px] overflow-hidden rounded-panel bg-step-deep text-paper">
      <Image src={src} alt={alt} fill loading="lazy" sizes="(min-width: 768px) 40vw, 1px" className="-z-10 object-cover" />
      <span aria-hidden="true" className="absolute inset-0 -z-10 bg-gradient-to-t from-black/65 via-black/10 to-transparent" />
      <div className="absolute left-0 top-0 rounded-br-3xl bg-paper pb-3 pr-3">
        <span className="flex items-center gap-2 rounded-2xl bg-step px-3 py-2 heading-6 text-ink">
          <Mark />
          AgroHub
        </span>
        <span className="notch-corner left-full top-0" data-at="br" />
        <span className="notch-corner left-0 top-full" data-at="br" />
      </div>
      <p className="absolute inset-x-6 bottom-6 max-w-[28ch] heading-5">{caption}</p>
    </div>
  );
}

export function PhotoCredit({ photo }: { photo: PhotoKey }) {
  const { what, by, license, url } = PHOTOS[photo].credit;
  return (
    <p className="mt-2 px-2 caption-2 text-ink-soft">
      Photo:{" "}
      <a href={url} className="underline underline-offset-2 hover:text-ink" target="_blank" rel="noreferrer">
        {what}
      </a>{" "}
      by {by} ({license}), Wikimedia Commons.
    </p>
  );
}
