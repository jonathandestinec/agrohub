import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { getTranslations } from "next-intl/server";
import { requireActorForPage } from "@/app/(auth)/require-actor-page";
import { ThreadPanel } from "@/components/messages/thread-panel";
import { PageHeading } from "@/components/ui";
import { NotFoundError } from "@/lib/errors";
import { getThread, type ThreadView } from "@/modules/messaging/service";

export default function ThreadPage({ params }: PageProps<"/messages/[id]">) {
  return (
    <Suspense fallback={null}>
      <Thread params={params} />
    </Suspense>
  );
}

async function Thread({ params }: { params: PageProps<"/messages/[id]">["params"] }) {
  const actor = await requireActorForPage();
  const { id } = await params;
  let thread: ThreadView;
  try {
    thread = await getThread(actor, id);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }
  const t = await getTranslations("messages");

  return (
    <main id="main" className="flex flex-1 flex-col gap-6 rounded-panel bg-step p-4 md:p-8">
      <PageHeading title={thread.title} lead={t(`kind.${thread.kind}`, { crop: thread.lot.crop })}>
        <Link href="/messages" className="underline underline-offset-2">
          {t("back")}
        </Link>
      </PageHeading>
      <ThreadPanel thread={thread} />
    </main>
  );
}
