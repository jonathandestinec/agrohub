"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Chevron } from "./icons";
import { menuStep } from "./menu-keys";

const ITEMS = "a[href], button:not([disabled])";

// A dropdown: a button that discloses a panel of links or buttons. Escape, a click outside,
// scrolling and Tab leaving the panel close it; Escape returns focus to the button. Arrow keys,
// Home and End move between the items. The panel sits after the button in the page, so Tab
// walks into it without any scripting. No library.
export function Menu({
  button,
  buttonLabel,
  buttonClassName,
  current = false,
  align = "start",
  hideChevron = false,
  children,
}: {
  button: ReactNode;
  // Spoken name of the button when its visible content is short (initials).
  buttonLabel?: string;
  buttonClassName: string;
  // The page being shown is inside this menu.
  current?: boolean;
  align?: "start" | "end";
  // For a trigger that is a round avatar: no arrow beside it.
  hideChevron?: boolean;
  children: ReactNode;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);

  const items = () => Array.from(panel.current?.querySelectorAll<HTMLElement>(ITEMS) ?? []);
  const focusItem = (at: number) => items()[at]?.focus();
  const close = (returnFocus: boolean) => {
    setOpen(false);
    if (returnFocus) trigger.current?.focus();
  };

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node | null)) setOpen(false);
    };
    // Scrolling away closes it (the pinned bar narrows and goes inert), but not a nudge.
    const openedAt = window.scrollY;
    const onScroll = () => {
      if (Math.abs(window.scrollY - openedAt) > 24) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("scroll", onScroll);
    };
  }, [open]);

  function onKeyDown(event: React.KeyboardEvent) {
    if (event.key === "Escape" && open) {
      event.preventDefault();
      event.stopPropagation();
      close(true);
      return;
    }
    const list = items();
    const at = list.indexOf(document.activeElement as HTMLElement);
    // Tab off the last item leaves the menu: close it and let Tab carry on from the button.
    if (event.key === "Tab" && !event.shiftKey && open && at === list.length - 1 && at !== -1) {
      close(true);
      return;
    }
    const arrowOpens = !open && (event.key === "ArrowDown" || event.key === "ArrowUp");
    const next = menuStep(event.key, at, list.length || 1);
    if (next === null || (!open && !arrowOpens)) return;
    event.preventDefault();
    if (!open) {
      setOpen(true);
      // The panel is not in the page yet: focus its item once it is.
      requestAnimationFrame(() => {
        const opened = items();
        opened[event.key === "ArrowUp" ? opened.length - 1 : 0]?.focus();
      });
      return;
    }
    focusItem(next);
  }

  return (
    <div
      ref={root}
      className="relative"
      onKeyDown={onKeyDown}
      onBlur={(event) => {
        if (open && !root.current?.contains(event.relatedTarget as Node | null)) setOpen(false);
      }}
    >
      <button
        ref={trigger}
        type="button"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        aria-label={buttonLabel}
        data-current={current ? "" : undefined}
        onClick={() => setOpen(!open)}
        className={buttonClassName}
      >
        {button}
        {hideChevron ? null : (
          <Chevron className={`size-4 transition-transform duration-300 ${open ? "rotate-180" : ""}`} />
        )}
      </button>
      {open ? (
        <div
          ref={panel}
          id={id}
          onClick={(event) => {
            if ((event.target as HTMLElement).closest("a[href]")) setOpen(false);
          }}
          className={`absolute top-full z-40 mt-2 flex min-w-52 flex-col gap-1 rounded-inner bg-paper p-2 shadow-[0_12px_32px_rgb(16_20_15/0.14)] ring-1 ring-ink/10 ${
            align === "end" ? "right-0" : "left-0"
          }`}
        >
          {children}
        </div>
      ) : null}
    </div>
  );
}

// A link or button row inside a Menu's panel.
export const MENU_ITEM =
  "press flex min-h-11 w-full items-center rounded-tile px-3 text-left title-4 hover:bg-step aria-[current=page]:bg-ink aria-[current=page]:text-paper";
