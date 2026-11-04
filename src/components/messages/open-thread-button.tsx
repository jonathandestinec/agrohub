"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { FormError } from "@/components/auth-ui";
import { Button } from "@/components/ui";
import { openLotThreadAction } from "@/app/messages/actions";
import { messageErrorKey } from "./error-key";

// Opens (or finds) the lot's thread for the signed-in buyer, farmer or officer and goes to it.
export function OpenThreadButton({ lotId, label }: { lotId: string; label: string }) {
  const t = useTranslations("messages");
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function open() {
    setPending(true);
    setError(null);
    const result = await openLotThreadAction({ lotId });
    if (!result.ok) {
      setPending(false);
      setError(t(`errors.${messageErrorKey(result.code)}`));
      return;
    }
    router.push(`/messages/${result.data.threadId}`);
  }

  return (
    <div className="flex flex-col gap-2">
      <div>
        <Button tone="paper" onClick={() => void open()} disabled={pending}>
          {label}
        </Button>
      </div>
      <FormError message={error} />
    </div>
  );
}
