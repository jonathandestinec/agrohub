"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

const LINKS = [
  { href: "/demo/market", label: "Market" },
  { href: "/demo/prices", label: "Prices" },
  { href: "/demo/join", label: "Join" },
  { href: "/demo/farmer", label: "Farmer" },
  { href: "/demo/officer", label: "Officer" },
  { href: "/demo/admin", label: "Admin" },
];

function isCurrent(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

// Pinned-nav state: "scrolled" once the page leaves the top; "compact" while scrolling down
// past the hero, and back to full the moment the visitor scrolls up.
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

export function DemoNav() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const { scrolled, compact } = useScrollCompact();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open]);

  return (
    <header className="relative z-30 h-[52px]">
      {/* Pinned: the bar floats over the page, and the header keeps its place in the flow. */}
      <div className="fixed inset-x-0 top-0 z-30 flex justify-center px-4 pt-4 md:px-7 md:pt-7">
        <div className="w-full max-w-[1304px]">
          <div
            data-compact={compact ? "" : undefined}
            data-scrolled={scrolled ? "" : undefined}
            className="nav-bar relative mx-auto flex items-center justify-between gap-3 overflow-hidden rounded-full p-1"
          >
            <BrandLink />
            <NavLinks pathname={pathname} hidden={compact} className="absolute left-1/2 top-1/2 hidden -translate-x-1/2 -translate-y-1/2 md:block" />
            <CallToAction />
            <MenuToggle open={open} setOpen={setOpen} controls="demo-menu" />
          </div>
        </div>
      </div>
      <MobileMenu id="demo-menu" open={open} setOpen={setOpen} pathname={pathname} />
    </header>
  );
}

function BrandLink() {
  return (
    <Link href="/demo" className="press relative z-10 flex min-h-11 shrink-0 items-center gap-2 rounded-full px-3 heading-6" aria-label="AgroHub home">
      <Mark />
      AgroHub
    </Link>
  );
}

function CallToAction() {
  return (
    <Link
      href="/demo/market"
      className="press relative z-10 hidden min-h-11 shrink-0 items-center rounded-full bg-[var(--d-lime)] px-5 button-sm text-[var(--d-lime-ink)] hover:bg-[#d0e45c] md:flex"
    >
      Browse harvests
    </Link>
  );
}

// Links stay in the DOM so the bar can animate; while hidden they are inert so keyboard
// and screen reader users never land on something they cannot see.
function NavLinks({ pathname, hidden, className }: { pathname: string; hidden: boolean; className: string }) {
  return (
    <nav aria-label="Demo" className={`nav-links ${className}`} inert={hidden}>
      <ul className="flex items-center gap-1">
        {LINKS.map((link, i) => {
          const current = isCurrent(pathname, link.href);
          return (
            <li key={link.href} style={{ transitionDelay: `${hidden ? i * 25 : 120 + i * 35}ms` }}>
              <Link
                href={link.href}
                aria-current={current ? "page" : undefined}
                className={`press flex min-h-11 items-center whitespace-nowrap rounded-full px-4 title-4 ${
                  current ? "bg-[var(--d-ink)] text-white" : "bg-[var(--d-step)] hover:bg-[var(--d-step-2)]"
                }`}
              >
                {link.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

function MenuToggle({ open, setOpen, controls }: { open: boolean; setOpen: (fn: (v: boolean) => boolean) => void; controls: string }) {
  return (
    <button
      type="button"
      className="press relative z-50 flex size-11 shrink-0 items-center justify-center rounded-full bg-[var(--d-step)] md:hidden"
      aria-expanded={open}
      aria-controls={controls}
      aria-label={open ? "Close menu" : "Open menu"}
      onClick={() => setOpen((v) => !v)}
    >
      <span className="relative block h-3 w-4" aria-hidden="true">
        <span
          className="absolute left-0 top-0 h-0.5 w-4 rounded bg-current transition-transform duration-500 ease-[cubic-bezier(0.22,1,0.36,1)]"
          style={{ transform: open ? "translateY(5px) rotate(45deg)" : "none" }}
        />
        <span
          className="absolute bottom-0 left-0 h-0.5 w-4 rounded bg-current transition-transform duration-500 ease-[cubic-bezier(0.22,1,0.36,1)]"
          style={{ transform: open ? "translateY(-5px) rotate(-45deg)" : "none" }}
        />
      </span>
    </button>
  );
}

function MobileMenu({
  id,
  open,
  setOpen,
  pathname,
}: {
  id: string;
  open: boolean;
  setOpen: (v: boolean) => void;
  pathname: string;
}) {
  return (
    <div
      id={id}
      data-open={open ? "" : undefined}
      inert={!open}
      className={`fixed inset-0 z-20 bg-[var(--d-paper)]/95 px-4 pt-24 backdrop-blur-xl transition-opacity duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] md:hidden ${
        open ? "opacity-100" : "pointer-events-none opacity-0"
      }`}
    >
      <ul className="flex flex-col gap-2">
        {[{ href: "/demo", label: "Home" }, ...LINKS].map((link, i) => (
          <li key={link.href} className="menu-link" style={{ transitionDelay: open ? `${Math.min(i * 60, 340)}ms` : "0ms" }}>
            <Link
              href={link.href}
              aria-current={pathname === link.href ? "page" : undefined}
              onClick={() => setOpen(false)}
              className="flex min-h-14 items-center justify-between rounded-2xl bg-[var(--d-step)] px-5 heading-5 aria-[current=page]:bg-[var(--d-lime)]"
            >
              {link.label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Mark() {
  return (
    <svg viewBox="0 0 32 32" className="size-7" aria-hidden="true">
      <circle cx="16" cy="16" r="16" fill="var(--d-lime)" />
      {/* Each leaf sways from where it meets the stem; see .mark-leaf in demo.css. */}
      <path className="mark-leaf mark-leaf-right" d="M16 12c0-3 2.5-5 6-5 0 3.5-2.5 6-6 5Z" fill="var(--d-forest)" />
      <path className="mark-leaf mark-leaf-left" d="M16 16c0-3-2.5-5-6-5 0 3.5 2.5 6 6 5Z" fill="var(--d-forest)" />
    </svg>
  );
}
