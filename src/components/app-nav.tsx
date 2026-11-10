"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Mark } from "@/components/ui/icons";
import { Menu, MENU_ITEM } from "@/components/ui/menu";
import { centreNavLinks, currentHref, itemIsCurrent, navBreakpoint } from "./nav-current";

const BREAKPOINT_CLASSES = {
  lg: { block: "hidden lg:block", flex: "hidden lg:flex", narrowOnly: "lg:hidden" },
  xl: { block: "hidden xl:block", flex: "hidden xl:flex", narrowOnly: "xl:hidden" },
  menu: { block: "hidden", flex: "hidden", narrowOnly: "" },
} as const;

const PILL = "press flex min-h-11 items-center gap-1 whitespace-nowrap rounded-full px-4 title-4";

export type AppNavLink = { href: string; label: string };
// One item in the bar: a link, or a labelled group that opens a dropdown of links.
export type AppNavItem =
  | { kind: "link"; href: string; label: string }
  | { kind: "group"; label: string; links: AppNavLink[] };

// Pinned-nav state, as in the demo: "scrolled" once the page leaves the top; "compact" while
// scrolling down past the first screenful, and back to full the moment the reader scrolls up.
function useScrollCompact(threshold = 120) {
  const [state, setState] = useState({ scrolled: false, compact: false });
  useEffect(() => {
    let last = window.scrollY;
    let frame = 0;
    const update = () => {
      frame = 0;
      const y = window.scrollY;
      const dy = y - last;
      if (Math.abs(dy) < 6 && y > 8) return;
      last = y;
      setState((s) => {
        const scrolled = y > 8;
        const compact = y <= threshold ? false : dy > 0 ? true : dy < 0 ? false : s.compact;
        return s.scrolled === scrolled && s.compact === compact ? s : { scrolled, compact };
      });
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    frame = requestAnimationFrame(update);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(frame);
    };
  }, [threshold]);
  return state;
}

// The header: a bar pinned over the page with the wordmark, pill links for the active role
// (current page in ink) and the account controls. Scrolling down narrows it to a pill;
// scrolling up, or keyboard focus entering it, brings it back. On phones a round toggle opens
// a full-height menu that is only rendered while open, so closed it can't be reached by
// keyboard and the page keeps one navigation landmark.
export function AppNav({
  items,
  label,
  homeLabel,
  openLabel,
  closeLabel,
  hasSwitcher,
  switcher,
  bell = null,
  account,
}: {
  items: AppNavItem[];
  label: string;
  homeLabel: string;
  openLabel: string;
  closeLabel: string;
  hasSwitcher: boolean;
  switcher: ReactNode;
  // Reserved: notifications go here, between the links and the account button.
  bell?: ReactNode;
  account: ReactNode;
}) {
  const links = items; // the bar's items; "links" in the layout code below
  const allHrefs = items.flatMap((item) => (item.kind === "link" ? [item.href] : item.links.map((l) => l.href)));
  const pathname = usePathname();
  // Open on the page it was opened on; navigating anywhere closes it without an effect.
  const [openOn, setOpenOn] = useState<string | null>(null);
  const open = openOn === pathname;
  const [focused, setFocused] = useState(false);
  const { scrolled, compact: scrollCompact } = useScrollCompact();
  const compact = scrollCompact && !focused && !open;
  const hasLinks = links.length > 0;
  // The round menu holds whatever does not fit the bar: the links, and the role switcher too.
  // navBreakpoint says from which width the full bar fits. Class names stay whole for Tailwind.
  const hasMenu = hasLinks || hasSwitcher;
  const wide = BREAKPOINT_CLASSES[navBreakpoint(links.length, hasSwitcher)];
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

  // Three or more links fill the centre of the bar; one or two join the account action.
  const centred = centreNavLinks(links.length);
  const linkNav = (placement: string) => (
    <nav aria-label={label} inert={compact} className={`nav-links ${placement}`}>
      <ul className="flex items-center gap-1">
        {links.map((item, i) => {
          const current = itemIsCurrent(item, pathname, allHrefs);
          const delay = { transitionDelay: `${compact ? i * 25 : 120 + i * 35}ms` };
          if (item.kind === "group") {
            const here = currentHref(pathname, allHrefs);
            return (
              <li key={item.label} style={delay}>
                <Menu
                  button={item.label}
                  current={current}
                  buttonClassName={`${PILL} bg-step hover:bg-step-deep data-[current]:bg-ink data-[current]:text-paper`}
                >
                  {item.links.map((link) => (
                    <Link
                      key={link.href}
                      href={link.href}
                      aria-current={link.href === here ? "page" : undefined}
                      className={MENU_ITEM}
                    >
                      {link.label}
                    </Link>
                  ))}
                </Menu>
              </li>
            );
          }
          return (
            <li key={item.href} style={delay}>
              <Link
                href={item.href}
                aria-current={current ? "page" : undefined}
                className={`${PILL} ${current ? "bg-ink text-paper" : "bg-step hover:bg-step-deep"}`}
              >
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );

  const bar = (
    <div className="fixed inset-x-0 top-0 z-30 flex justify-center px-4 pt-4 md:px-7 md:pt-7">
      <div className="w-full max-w-[1304px]">
        <div
          data-compact={compact ? "" : undefined}
          data-scrolled={scrolled ? "" : undefined}
          onFocus={() => setFocused(true)}
          onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocused(false);
          }}
          className="nav-bar relative mx-auto flex items-center justify-between gap-3 rounded-full p-1"
        >
          <Link
            href="/"
            aria-label={homeLabel}
            className="press relative z-10 flex min-h-11 shrink-0 items-center gap-2 rounded-full px-3 heading-6"
          >
            <Mark />
            AgroHub
          </Link>

          {hasLinks && centred ? linkNav(`absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 ${wide.block}`) : null}

          <div className="relative z-10 flex shrink-0 items-center gap-2">
            {hasLinks && !centred ? linkNav(compact ? "hidden" : wide.block) : null}
            <div className={`${compact ? "hidden" : hasMenu ? wide.flex : "flex"} items-center`}>{switcher}</div>
            {bell ? <div className={`${hasMenu ? wide.flex : "flex"} items-center`}>{bell}</div> : null}
            <div className={`${hasMenu ? wide.flex : "flex"} items-center`}>{account}</div>
            {hasMenu ? (
              <button
                ref={toggle}
                type="button"
                className={`press relative z-50 flex size-11 shrink-0 items-center justify-center rounded-full bg-step ${wide.narrowOnly}`}
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
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );

  const panel = open ? (
    <div
      ref={menu}
      id="app-menu"
      className={`menu-panel fixed inset-0 z-20 overflow-y-auto bg-paper/95 px-4 pb-8 pt-24 backdrop-blur-xl ${wide.narrowOnly}`}
    >
      {hasLinks ? (
        <nav aria-label={label}>
          <ul className="flex flex-col gap-2">
            {links.map((item, i) => {
              const here = currentHref(pathname, allHrefs);
              const delay = { animationDelay: `${Math.min(i * 60, 340)}ms` };
              const row = (link: AppNavLink) => (
                <Link
                  href={link.href}
                  aria-current={link.href === here ? "page" : undefined}
                  onClick={() => setOpenOn(null)}
                  className="flex min-h-14 items-center rounded-2xl bg-step px-5 heading-5 aria-[current=page]:bg-lime aria-[current=page]:text-lime-ink"
                >
                  {link.label}
                </Link>
              );
              if (item.kind === "link") {
                return (
                  <li key={item.href} className="menu-link" style={delay}>
                    {row(item)}
                  </li>
                );
              }
              return (
                <li key={item.label} className="menu-link" style={delay}>
                  <section aria-label={item.label} className="flex flex-col gap-2">
                    <h2 className="px-2 pt-2 caption-4 uppercase tracking-wide text-ink-soft">{item.label}</h2>
                    <ul className="flex flex-col gap-2">
                      {item.links.map((link) => (
                        <li key={link.href}>{row(link)}</li>
                      ))}
                    </ul>
                  </section>
                </li>
              );
            })}
          </ul>
        </nav>
      ) : null}
      <div className={`menu-link ${hasLinks ? "mt-6" : ""} flex flex-wrap items-center gap-2`} style={{ animationDelay: "340ms" }}>
        {switcher}
        {account}
      </div>
    </div>
  ) : null;

  return (
    <header className="relative z-30 h-[52px]">
      {bar}
      {panel}
    </header>
  );
}
