import Link from "next/link";
import { getTranslations } from "next-intl/server";

// The demo's footer: one plain line, pill links, and the large wordmark.
export async function AppFooter({ signedIn }: { signedIn: boolean }) {
  const t = await getTranslations("footer");
  const links = [
    { href: "/prices", label: t("prices") },
    { href: "/privacy", label: t("privacy") },
    ...(signedIn ? [] : [{ href: "/sign-in", label: t("signIn") }]),
  ];
  return (
    <footer className="mt-24 overflow-hidden rounded-panel bg-step px-6 pb-6 pt-12 md:px-10 md:pt-16">
      <div className="flex flex-col justify-between gap-8 md:flex-row">
        <p className="max-w-md body-3">{t("about")}</p>
        <ul className="flex flex-wrap gap-2">
          {links.map((l) => (
            <li key={l.href}>
              <Link href={l.href} className="press flex min-h-11 items-center rounded-full bg-paper px-4 title-4 hover:bg-step-deep">
                {l.label}
              </Link>
            </li>
          ))}
        </ul>
      </div>
      <p
        aria-hidden="true"
        className="mt-12 select-none text-[22vw] font-semibold leading-none tracking-[-0.06em] text-ink md:text-[17vw] xl:text-[15rem]"
      >
        AgroHub
      </p>
    </footer>
  );
}
