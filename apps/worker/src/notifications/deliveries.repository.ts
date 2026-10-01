import type { Database } from "@dsd/db";
import { notificationDeliveries } from "@dsd/db/schema";
import { and, eq, sql } from "drizzle-orm";

import type { DeliveryKey, DeliveryStore } from "./notification-service.js";

const matching = (key: DeliveryKey) =>
  and(
    eq(notificationDeliveries.eventId, key.eventId),
    sql`${notificationDeliveries.channel} = ${key.channel}::notification_channel`,
    eq(notificationDeliveries.recipientAddress, key.address),
  );

/** `notification_deliveries` in PostgreSQL. The worker may select, insert and update it. */
export class PgDeliveryStore implements DeliveryStore {
  constructor(private readonly db: Database) {}

  async open(
    key: DeliveryKey,
    details: Parameters<DeliveryStore["open"]>[1],
  ): Promise<{ alreadySent: boolean }> {
    await this.db
      .insert(notificationDeliveries)
      .values({
        eventId: key.eventId,
        channel: sql`${key.channel}::notification_channel`,
        recipientCustomerId:
          details.recipient.kind === "customer"
            ? details.recipient.customerId
            : null,
        recipientAgentId:
          details.recipient.kind === "agent" ? details.recipient.agentId : null,
        recipientAddress: key.address,
        template: details.template,
        ticketId: details.ticketId,
      })
      .onConflictDoNothing();
    const [row] = await this.db
      .select({ status: notificationDeliveries.status })
      .from(notificationDeliveries)
      .where(matching(key));
    return { alreadySent: row?.status === "sent" };
  }

  async attempted(key: DeliveryKey): Promise<void> {
    await this.db
      .update(notificationDeliveries)
      .set({ attempts: sql`${notificationDeliveries.attempts} + 1` })
      .where(matching(key));
  }

  async sent(
    key: DeliveryKey,
    providerMessageId: string | null,
  ): Promise<void> {
    await this.db
      .update(notificationDeliveries)
      .set({
        status: "sent",
        sentAt: sql`now()`,
        providerMessageId,
        lastError: null,
      })
      .where(matching(key));
  }

  async attemptFailed(key: DeliveryKey, error: string): Promise<void> {
    await this.db
      .update(notificationDeliveries)
      .set({ lastError: error })
      .where(matching(key));
  }

  /**
   * Marks an event's unsent deliveries failed, once its job has run out of
   * attempts and gone to the dead-letter queue (ADR-0005, section 4).
   */
  async failUnsent(eventId: string, error: string): Promise<number> {
    const rows = await this.db
      .update(notificationDeliveries)
      .set({ status: "failed", lastError: error })
      .where(
        and(
          eq(notificationDeliveries.eventId, eventId),
          eq(notificationDeliveries.status, "pending"),
        ),
      )
      .returning({ id: notificationDeliveries.id });
    return rows.length;
  }
}
