import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { getLocale, getTranslations } from "next-intl/server";
import { requireActorForPage } from "@/app/(auth)/require-actor-page";
import { ArrowUpRight, PageHeading } from "@/components/ui";
import { listOwnThreads } from "@/modules/messaging/service";

const ROLES_WITH_THREADS = ["BUYER", "FARMER", "OFFICER", "ADMIN"];

export default function MessagesPage() {
  return (
    <Suspense fallback={null}>
      <Messages />
    </Suspense>
  );
}

async function Messages() {
  const actor = await requireActorForPage();
  if (!ROLES_WITH_THREADS.includes(actor.role)) notFound();
  const t = await getTranslations("messages");
  const locale = await getLocale();
  const time = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short", timeZone: "Africa/Lagos" });
  const threads = await listOwnThreads(actor);

  return (
    <main id="main" className="flex flex-1 flex-col gap-6 rounded-panel bg-step p-4 md:p-8">
      <PageHeading title={t("title")} lead={t("lead")} />
      {threads.length === 0 ? (
        <p className="body-3 text-ink-soft">{t("empty")}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {threads.map((thread) => (
            <li key={thread.id}>
              <Link
                href={`/messages/${thread.id}`}
                className="press press-lift flex min-h-11 items-center justify-between gap-4 rounded-inner bg-paper p-4 hover:bg-step-deep md:p-6"
              >
                <span className="flex min-w-0 flex-col gap-1">
                  <span className="title-2 break-words">{thread.title}</span>
                  <span className="body-6 text-ink-soft">
                    {t(`kind.${thread.kind}`, { crop: thread.lot.crop })} · {time.format(new Date(thread.lastMessageAt))}
                  </span>
                  {thread.lastMessage ? <span className="body-5 truncate">{thread.lastMessage}</span> : null}
                </span>
                <ArrowUpRight />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
