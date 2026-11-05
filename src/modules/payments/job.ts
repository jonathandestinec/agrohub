import { defineJob } from "@/lib/jobs/registry";
import { reconcile } from "./reconcile";
import { sendDuePayouts } from "./sending";

// Daily at 06:30 UTC (vercel.json): payouts whose funds have cleared since yesterday, and
// those deferred for a low Paystack balance. Payouts already cleared are sent at release.
defineJob("payouts", () => sendDuePayouts({ now: new Date() }).then(() => {}));

// Daily at 07:00 UTC (vercel.json): compare the last 3 days with Paystack and flag what is left.
defineJob("reconciliation", () => reconcile(new Date()).then(() => {}));
