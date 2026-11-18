import { after } from "next/server";

// Runs `task` after the response is sent (Next's after(), which Vercel keeps alive), so slow
// work such as email never holds up a webhook, cron or action. Outside a request scope (tests,
// scripts) there is no after(), so the task runs inline and is awaited. Never rejects.
export async function deferWork(task: () => Promise<void>): Promise<void> {
  const safe = async () => {
    try {
      await task();
    } catch (error) {
      console.error("deferred work failed", {
        error: error instanceof Error ? { name: error.name } : "non-Error thrown",
      });
    }
  };
  try {
    after(safe);
    return;
  } catch (error) {
    if (!(error instanceof Error) || !/outside a request scope/i.test(error.message)) {
      console.error("after() unavailable", { error: error instanceof Error ? error.name : "non-Error thrown" });
    }
  }
  await safe();
}
