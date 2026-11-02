"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

const LINKS = [
  { href: "/demo/market", label: "Market" },
  { href: "/demo/prices", label: "Prices" },
  { href: "/demo/farmer", label: "Farmer" },
  { href: "/demo/officer", label: "Officer" },
  { href: "/demo/admin", label: "Admin" },
];

function isCurrent(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function DemoNav() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

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
    <header className="relative z-30 flex items-center justify-between gap-3 px-1 py-1">
      <Link href="/demo" className="press flex min-h-11 items-center gap-2 rounded-full px-3 heading-6" aria-label="AgroHub home">
        <Mark />
        AgroHub
      </Link>

      <nav aria-label="Demo" className="hidden md:block">
        <ul className="flex items-center gap-1">
          {LINKS.map((link) => {
            const current = isCurrent(pathname, link.href);
            return (
              <li key={link.href}>
                <Link
                  href={link.href}
                  aria-current={current ? "page" : undefined}
                  className={`press flex min-h-11 items-center rounded-full px-4 title-4 ${
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

      <Link
        href="/demo/market"
        className="press hidden min-h-11 items-center rounded-full bg-[var(--d-lime)] px-5 button-sm text-[var(--d-lime-ink)] hover:bg-[#d0e45c] md:flex"
      >
        Browse harvests
      </Link>

      <button
        type="button"
        className="press relative z-50 flex size-11 items-center justify-center rounded-full bg-[var(--d-step)] md:hidden"
        aria-expanded={open}
        aria-controls="demo-menu"
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

      <div
        id="demo-menu"
        data-open={open ? "" : undefined}
        inert={!open}
        className={`fixed inset-0 z-40 bg-[var(--d-paper)]/95 px-4 pt-24 backdrop-blur-xl transition-opacity duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] md:hidden ${
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
    </header>
  );
}

function Mark() {
  return (
    <svg viewBox="0 0 32 32" className="size-7" aria-hidden="true">
      <circle cx="16" cy="16" r="16" fill="var(--d-lime)" />
      <path d="M16 24V12m0 0c0-3 2.5-5 6-5 0 3.5-2.5 6-6 5Zm0 4c0-3-2.5-5-6-5 0 3.5 2.5 6 6 5Z" fill="var(--d-forest)" />
    </svg>
  );
}
