import { createTransport, type Transporter } from "nodemailer";

import type { Env } from "../config/env.js";
import type {
  DeliveryResult,
  NotificationChannel,
  Recipient,
  RenderedNotification,
  Sender,
} from "./channel.js";

/** Long enough for a slow provider, short enough that a dead one fails a job quickly. */
const TIMEOUT_MS = 15_000;

/**
 * Email over SMTP with Nodemailer: Mailpit locally, any provider in
 * production. A send that fails throws, and the queue retries the job.
 */
export class EmailChannel implements NotificationChannel {
  readonly kind = "email";
  private readonly transport: Transporter;

  constructor(
    env: Pick<
      Env,
      "SMTP_HOST" | "SMTP_PORT" | "SMTP_SECURE" | "SMTP_USER" | "SMTP_PASSWORD"
    >,
  ) {
    this.transport = createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_SECURE,
      auth:
        env.SMTP_USER === undefined || env.SMTP_PASSWORD === undefined
          ? undefined
          : { user: env.SMTP_USER, pass: env.SMTP_PASSWORD },
      connectionTimeout: TIMEOUT_MS,
      greetingTimeout: TIMEOUT_MS,
      socketTimeout: TIMEOUT_MS,
    });
  }

  addressOf(recipient: Recipient): string {
    return recipient.email;
  }

  async send(
    to: string,
    from: Sender,
    message: RenderedNotification,
  ): Promise<DeliveryResult> {
    const info = (await this.transport.sendMail({
      from: { name: from.name, address: from.address },
      to,
      subject: message.subject,
      text: message.text,
      html: message.html,
    })) as { messageId?: string };
    return { providerMessageId: info.messageId ?? null };
  }

  close(): void {
    this.transport.close();
  }
}
