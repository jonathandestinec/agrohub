"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { FormError } from "@/components/auth-ui";
import { Button } from "@/components/ui";
import { postMessageAction } from "@/app/messages/actions";
import { messageErrorKey } from "./error-key";

export function ReplyForm({ threadId }: { threadId: string }) {
  const t = useTranslations("messages");
  const router = useRouter();
  const [body, setBody] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    const result = await postMessageAction({ threadId, body });
    setPending(false);
    if (!result.ok) {
      setError(t(`errors.${messageErrorKey(result.code)}`));
      return;
    }
    setBody("");
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-2">
      <label htmlFor={`reply-${threadId}`} className="body-6">
        {t("reply")}
      </label>
      <textarea
        id={`reply-${threadId}`}
        value={body}
        onChange={(event) => setBody(event.target.value)}
        maxLength={2000}
        rows={3}
        required
        className="min-h-24 w-full rounded-tile bg-paper p-3 body-4 outline-offset-2 focus-visible:outline-2 focus-visible:outline-ink"
      />
      <FormError message={error} />
      <div>
        <Button type="submit" tone="ink" disabled={pending || body.trim().length === 0}>
          {t("send")}
        </Button>
      </div>
    </form>
  );
}
