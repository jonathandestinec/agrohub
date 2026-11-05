import { defineJob } from "@/lib/jobs/registry";
import { expireUnpaidOrders } from "./expiry";

// Daily at 04:45 UTC (vercel.json). Reservations stop counting after 15 minutes on every read;
// this only cancels checkouts left unpaid for a day.
defineJob("order-expiry", () => expireUnpaidOrders(new Date()).then(() => {}));
