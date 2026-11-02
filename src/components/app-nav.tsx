"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { isCurrent } from "./nav-current";

export type AppNavLink = { href: string; label: string };

// Pill links for the active role (current page in ink), and on phones a round toggle that
// opens a full-height menu. The menu is only rendered while open, so closed it can't be
// reached by keyboard and the page keeps a single navigation landmark.
export function AppNav({
  links,
  label,
  openLabel,
  closeLabel,
  extras,
}: {
  links: AppNavLink[];
  label: string;
  openLabel: string;
  closeLabel: string;
  extras: ReactNode;
}) {
  const pathname = usePathname();
  // Open on the page it was opened on; navigating anywhere closes it without an effect.
  const [openOn, setOpenOn] = useState<string | null>(null);
  const open = openOn === pathname;
  const toggle = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpenOn(null);
        toggle.current?.focus();
        return;
      }
      // Keep Tab inside the open menu (the toggle plus the menu's controls, wrapping round),
      // so focus never lands on page content hidden behind the overlay.
      if (event.key !== "Tab" || !toggle.current || !menu.current) return;
      const items = [
        toggle.current,
        ...menu.current.querySelectorAll<HTMLElement>(
          "a[href], button:not([disabled]), select:not([disabled])",
        ),
      ];
      const at = items.indexOf(document.activeElement as HTMLElement);
      const last = items.length - 1;
      const next = event.shiftKey ? (at <= 0 ? last : at - 1) : at === -1 || at === last ? 0 : at + 1;
      event.preventDefault();
      items[next].focus();
    };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open]);

  if (links.length === 0) return <div className="flex items-center gap-2">{extras}</div>;

  return (
    <>
      <nav aria-label={label} className="hidden md:block">
        <ul className="flex flex-wrap items-center gap-1">
          {links.map((link) => {
            const current = isCurrent(pathname, link.href);
            return (
              <li key={link.href}>
                <Link
                  href={link.href}
                  aria-current={current ? "page" : undefined}
                  className={`press flex min-h-11 items-center whitespace-nowrap rounded-full px-4 title-4 ${
                    current ? "bg-ink text-paper" : "bg-step hover:bg-step-deep"
                  }`}
                >
                  {link.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
      <div className="hidden items-center gap-2 md:flex">{extras}</div>

      <button
        ref={toggle}
        type="button"
        className="press relative z-50 flex size-11 shrink-0 items-center justify-center rounded-full bg-step md:hidden"
        aria-expanded={open}
        aria-controls="app-menu"
        aria-label={open ? closeLabel : openLabel}
        onClick={() => setOpenOn(open ? null : pathname)}
      >
        <span className="relative block h-3 w-4" aria-hidden="true">
          <span
            className="absolute left-0 top-0 h-0.5 w-4 rounded bg-current transition-transform duration-500 ease-[var(--ease)]"
            style={{ transform: open ? "translateY(5px) rotate(45deg)" : "none" }}
          />
          <span
            className="absolute bottom-0 left-0 h-0.5 w-4 rounded bg-current transition-transform duration-500 ease-[var(--ease)]"
            style={{ transform: open ? "translateY(-5px) rotate(-45deg)" : "none" }}
          />
        </span>
      </button>

      {open ? (
        <div ref={menu} id="app-menu" className="menu-panel fixed inset-0 z-40 overflow-y-auto bg-paper/95 px-4 pb-8 pt-24 backdrop-blur-xl md:hidden">
          <nav aria-label={label}>
            <ul className="flex flex-col gap-2">
              {links.map((link, i) => (
                <li key={link.href} className="menu-link" style={{ animationDelay: `${Math.min(i * 60, 340)}ms` }}>
                  <Link
                    href={link.href}
                    aria-current={isCurrent(pathname, link.href) ? "page" : undefined}
                    onClick={() => setOpenOn(null)}
                    className="flex min-h-14 items-center rounded-2xl bg-step px-5 heading-5 aria-[current=page]:bg-lime aria-[current=page]:text-lime-ink"
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
          <div className="menu-link mt-6 flex flex-wrap items-center gap-2" style={{ animationDelay: "340ms" }}>
            {extras}
          </div>
        </div>
      ) : null}
    </>
  );
}
