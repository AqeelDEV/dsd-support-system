import type { Logger } from "../logger.js";
import type {
  NotificationChannel,
  Recipient,
  RenderedNotification,
  Sender,
} from "./channel.js";
import {
  renderTemplate,
  type TemplateData,
  type TemplateName,
} from "./templates.js";

/** One delivery: an event, a channel and an address (`notification_deliveries`). */
export interface DeliveryKey {
  eventId: string;
  channel: string;
  address: string;
}

/**
 * Where deliveries are recorded. The unique key on (event, channel,
 * address) is what makes a repeated job send nothing twice (ADR-0005,
 * section 5).
 */
export interface DeliveryStore {
  /** Creates the delivery if it is new; says whether it was already sent. */
  open(
    key: DeliveryKey,
    details: {
      recipient: Recipient;
      template: TemplateName;
      ticketId: string | null;
    },
  ): Promise<{ alreadySent: boolean }>;
  attempted(key: DeliveryKey): Promise<void>;
  sent(key: DeliveryKey, providerMessageId: string | null): Promise<void>;
  /** Records why an attempt failed; the queue decides whether to try again. */
  attemptFailed(key: DeliveryKey, error: string): Promise<void>;
}

export interface Notification<Name extends TemplateName> {
  /** The outbox event behind it: one delivery per event, channel and address. */
  eventId: string;
  ticketId: string | null;
  recipient: Recipient;
  from: Sender;
  template: Name;
  /**
   * Builds the template's data. Called only if something is actually
   * going to be sent, so a repeated job doesn't, for example, create an
   * emailed-link token nobody receives.
   */
  data: () => Promise<TemplateData[Name]>;
}

/** Errors stored on a delivery are kept short; they're for people, not machines. */
const MAX_ERROR = 1_000;

/**
 * Sends notifications through every channel the recipient can be reached
 * on (FR-5, FR-20; ADR-0005, section 7). For each channel it records the
 * delivery, skips it if it was already sent, renders the template, sends,
 * and marks it sent. A send that throws is recorded and rethrown, so the
 * queue retries the job; deliveries that already went out are skipped on
 * the retry.
 *
 * A crash between the provider accepting a message and the row being
 * marked sent can send it twice. That is accepted: a rare duplicate is a
 * better failure than a missing email.
 */
export class NotificationService {
  constructor(
    private readonly channels: readonly NotificationChannel[],
    private readonly deliveries: DeliveryStore,
    private readonly logger: Logger,
  ) {}

  async notify<Name extends TemplateName>(
    notification: Notification<Name>,
  ): Promise<void> {
    let rendered: RenderedNotification | undefined;
    for (const channel of this.channels) {
      const address = channel.addressOf(notification.recipient);
      if (address === null) continue;
      const key: DeliveryKey = {
        eventId: notification.eventId,
        channel: channel.kind,
        address,
      };
      const { alreadySent } = await this.deliveries.open(key, {
        recipient: notification.recipient,
        template: notification.template,
        ticketId: notification.ticketId,
      });
      if (alreadySent) continue;

      rendered ??= renderTemplate(
        notification.template,
        await notification.data(),
      );
      await this.deliveries.attempted(key);
      try {
        const result = await channel.send(address, notification.from, rendered);
        await this.deliveries.sent(key, result.providerMessageId);
        this.logger.info(
          {
            eventId: notification.eventId,
            channel: channel.kind,
            template: notification.template,
          },
          "notification sent",
        );
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        await this.deliveries.attemptFailed(key, reason.slice(0, MAX_ERROR));
        throw error;
      }
    }
  }
}
