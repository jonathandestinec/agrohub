import { defineJob } from "@/lib/jobs/registry";
import { applyDueBankChanges } from "./service";

// Hourly (vercel.json). The cron route's per-minute runOnce key stops a duplicate
// delivery; per-request idempotency comes from BankChangeRequest.appliedAt.
defineJob("bank-change-apply", async () => {
  await applyDueBankChanges(new Date());
});
