import { Resend } from "resend";
import { env, type Env } from "@/lib/env";

export type EmailMessage = { to: string; subject: string; html: string };

export type TransportConfig = {
  appEnv: Env["APP_ENV"];
  nodeEnv: string | undefined;
  resendApiKey: string | undefined;
};

// TODO: the sending domain is not verified in Resend yet; replace before production.
const FROM_ADDRESS = "AgroHub <noreply@agrohub.example>";

export const fakeOutbox: { sent: EmailMessage[]; clear(): void } = {
  sent: [],
  clear() {
    this.sent.length = 0;
  },
};

export function selectTransport(config: TransportConfig): "fake" | "resend" {
  if (config.appEnv === "local" || config.nodeEnv === "test") return "fake";
  if (config.resendApiKey) return "resend";
  throw new Error(
    `RESEND_API_KEY is required to send email when APP_ENV is ${config.appEnv}`,
  );
}

let resendClient: Resend | undefined;

export async function sendEmailWith(
  config: TransportConfig,
  msg: EmailMessage,
): Promise<void> {
  if (selectTransport(config) === "fake") {
    fakeOutbox.sent.push({ to: msg.to, subject: msg.subject, html: msg.html });
    return;
  }
  // Built lazily on the first real send, never at import.
  resendClient ??= new Resend(config.resendApiKey);
  const { error } = await resendClient.emails.send({
    from: FROM_ADDRESS,
    to: msg.to,
    subject: msg.subject,
    html: msg.html,
  });
  if (error) {
    throw new Error(`Resend failed to send email (${error.name})`);
  }
}

export function sendEmail(msg: EmailMessage): Promise<void> {
  return sendEmailWith(
    {
      appEnv: env.APP_ENV,
      nodeEnv: process.env.NODE_ENV,
      resendApiKey: env.RESEND_API_KEY,
    },
    msg,
  );
}
