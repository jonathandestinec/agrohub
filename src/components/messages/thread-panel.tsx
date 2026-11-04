import { getLocale, getTranslations } from "next-intl/server";
import type { ThreadView } from "@/modules/messaging/service";
import { ReplyForm } from "./reply-form";

// A thread's messages, oldest first, and the reply form. Used on /messages/[id] and inline on
// offer and lot pages. Authors arrive already labelled for the viewer (messaging/views.ts).
export async function ThreadPanel({ thread }: { thread: ThreadView }) {
  const t = await getTranslations("messages");
  const locale = await getLocale();
  const time = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short", timeZone: "Africa/Lagos" });
  return (
    <section aria-label={t("threadLabel")} className="flex flex-col gap-3">
      {thread.messages.length === 0 ? (
        <p className="body-4 text-ink-soft">{t("emptyThread")}</p>
      ) : (
        <ol className="flex flex-col gap-2">
          {thread.messages.map((message) => (
            <li
              key={message.id}
              className={`flex max-w-[560px] flex-col gap-1 rounded-inner p-4 ${message.mine ? "self-end bg-lime/40" : "bg-paper"}`}
            >
              <span className="body-6 text-ink-soft">
                {message.mine ? t("you") : message.author} · {time.format(new Date(message.createdAt))}
              </span>
              <span className="body-4 whitespace-pre-wrap break-words">{message.body}</span>
            </li>
          ))}
        </ol>
      )}
      <p className="body-6 text-ink-soft">{t("noContact")}</p>
      <ReplyForm threadId={thread.id} />
    </section>
  );
}
