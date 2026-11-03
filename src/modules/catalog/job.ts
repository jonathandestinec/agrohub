import { defineJob } from "@/lib/jobs/registry";
import { expireLots } from "./public";

// Daily at 04:00 UTC (vercel.json), 05:00 in Lagos: the first run after a lot's last day.
// expireLots matches only lots still open, so a repeated delivery changes nothing.
defineJob("lot-expiry", () => expireLots(new Date()).then(() => {}));
