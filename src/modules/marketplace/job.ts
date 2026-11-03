import { defineJob } from "@/lib/jobs/registry";
import { expireOffers } from "./offers";

// Daily at 04:30 UTC (vercel.json), after lot-expiry, so offers on lots that expired overnight
// expire in the same morning. Offers past their time are refused on every action before this
// runs; the job only records it. expireOffers matches only offers still in the status it read.
defineJob("offer-expiry", () => expireOffers(new Date()).then(() => {}));
