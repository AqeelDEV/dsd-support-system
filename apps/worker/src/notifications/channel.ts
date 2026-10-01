/*
 * The notification interface (FR-20; ADR-0005, section 7). Everything that
 * notifies someone goes through `NotificationService`; adding SMS or
 * WhatsApp means a new channel here, a value in the `notification_channel`
 * enum, and a short-text variant of the templates. Nothing that raises
 * events changes.
 */

/** Who a notification is for. */
export type Recipient =
  | { kind: "customer"; customerId: string; email: string }
  | { kind: "agent"; agentId: string; email: string };

/**
 * A message rendered once for every channel: a channel uses what suits it
 * (email sends all three parts; SMS would send `text`). Every value in
 * `html` is already escaped.
 */
export interface RenderedNotification {
  subject: string;
  text: string;
  html: string;
}

/** The sender, from the brand the notification is about. */
export interface Sender {
  name: string;
  address: string;
}

export interface DeliveryResult {
  /** The provider's ID for the message, when it gives one. */
  providerMessageId: string | null;
}

export interface NotificationChannel {
  /** Stored as `notification_deliveries.channel`; `email` in v1. */
  readonly kind: string;
  /** The recipient's address on this channel, or null if they have none. */
  addressOf(recipient: Recipient): string | null;
  send(
    to: string,
    from: Sender,
    message: RenderedNotification,
  ): Promise<DeliveryResult>;
}
