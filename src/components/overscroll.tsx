"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { Mark } from "@/components/ui/icons";

const LIMIT = 200;

// Pure: how far the frame lifts for a given pull. Close to one to one for a small pull,
// then slower and slower, never past `limit` (an elastic band).
export function resist(pull: number, limit: number): number {
  if (pull <= 0) return 0;
  return limit * (1 - Math.exp(-pull / limit));
}

// Scrolling past the end of a page (wheel, touchpad or finger) lifts the frame and shows the
// logo large on the ground behind it; letting go springs the frame back. Browsers on Windows
// and Android have no rubber band of their own, so this draws one. Off under reduced motion.
// It moves the page with a relative `top`, not a transform: a transform would turn the pinned
// nav (position: fixed, inside the page) into part of the page and drag it away.
export function OverscrollReveal({ children }: { children: ReactNode }) {
  const frame = useRef<HTMLDivElement>(null);
  const logo = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const root = document.documentElement;
    let pull = 0;
    let touchY: number | null = null;
    let timer = 0;

    const atBottom = () => window.innerHeight + window.scrollY >= root.scrollHeight - 2;
    const paint = (springing: boolean) => {
      const lift = resist(pull, LIMIT);
      const shown = lift / LIMIT;
      const ease = springing ? "600ms cubic-bezier(0.34, 1.56, 0.64, 1)" : "0ms";
      if (frame.current) {
        frame.current.style.transition = `top ${ease}`;
        frame.current.style.top = lift ? `${-lift}px` : "";
      }
      if (logo.current) {
        logo.current.style.transition = springing ? "opacity 300ms ease-out, transform 600ms cubic-bezier(0.34, 1.56, 0.64, 1)" : "none";
        logo.current.style.opacity = String(shown);
        logo.current.style.transform = `scale(${0.6 + 0.4 * shown})`;
      }
    };
    const release = () => {
      pull = 0;
      paint(true);
    };

    const onWheel = (event: WheelEvent) => {
      if (event.deltaY > 0 && atBottom()) pull += event.deltaY;
      else if (event.deltaY < 0 && pull > 0) pull = Math.max(0, pull + event.deltaY);
      else return;
      paint(false);
      window.clearTimeout(timer);
      timer = window.setTimeout(release, 150);
    };
    const onTouchStart = (event: TouchEvent) => {
      touchY = atBottom() ? event.touches[0].clientY : null;
    };
    const onTouchMove = (event: TouchEvent) => {
      if (touchY === null) return;
      pull = Math.max(0, touchY - event.touches[0].clientY);
      paint(false);
    };
    const onTouchEnd = () => {
      touchY = null;
      if (pull > 0) release();
    };

    window.addEventListener("wheel", onWheel, { passive: true });
    window.addEventListener("touchstart", onTouchStart, { passive: true });
    window.addEventListener("touchmove", onTouchMove, { passive: true });
    window.addEventListener("touchend", onTouchEnd);
    window.addEventListener("touchcancel", onTouchEnd);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("wheel", onWheel);
      window.removeEventListener("touchstart", onTouchStart);
      window.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("touchend", onTouchEnd);
      window.removeEventListener("touchcancel", onTouchEnd);
    };
  }, []);

  return (
    <>
      <div
        ref={logo}
        data-overscroll-logo=""
        aria-hidden="true"
        className="pointer-events-none fixed inset-x-0 bottom-0 flex h-[220px] items-center justify-center opacity-0"
      >
        <Mark className="size-36 md:size-40" />
      </div>
      <div ref={frame} data-overscroll-frame="" className="relative">
        {children}
      </div>
    </>
  );
}
