import { defineJob } from "@/lib/jobs/registry";
import { runCertificateExpiry } from "./expiry";

// Daily at 06:00 UTC (vercel.json), 07:00 in Lagos. Reminders and the admin digest
// carry their own runOnce keys, so a repeated delivery does not email twice.
defineJob("certificate-expiry", () => runCertificateExpiry(new Date()).then(() => {}));
