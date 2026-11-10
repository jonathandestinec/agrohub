import { defineJob } from "@/lib/jobs/registry";
import { runOrderTimers } from "./disputes";
import { expireUnpaidOrders } from "./expiry";

// Daily at 04:45 UTC (vercel.json). Reservations stop counting after 15 minutes on every read;
// this only cancels checkouts left unpaid for a day.
defineJob("order-expiry", () => expireUnpaidOrders(new Date()).then(() => {}));

// Daily at 05:30 UTC (vercel.json): auto-release 72 hours after a delivery mark (so up to a day
// late on the daily schedule), and the 14-day timeout for orders never marked delivered.
defineJob("order-timers", () => runOrderTimers(new Date()).then(() => {}));
