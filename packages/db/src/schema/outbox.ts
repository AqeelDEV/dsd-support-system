import { sql } from "drizzle-orm";
import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

import { createdAt, id, timestamptz } from "./columns.js";
import { notificationChannel, notificationStatus } from "./enums.js";
import { agents, customers } from "./identity.js";
import { tickets } from "./tickets.js";

/**
 * Domain events, written in the same transaction as the change they
 * describe and moved onto the job queues by the worker's dispatcher
 * (ADR-0005). A transport, not a history: dispatched rows are removed
 * after seven days.
 */
export const outboxEvents = pgTable(
  "outbox_events",
  {
    /** Time-ordered, so the dispatcher processes events in order. */
    id: id(),
    /** One of DOMAIN_EVENTS in @dsd/shared. */
    eventType: text("event_type").notNull(),
    aggregateType: text("aggregate_type").notNull(),
    aggregateId: uuid("aggregate_id").notNull(),
    /** IDs and small facts only: never message bodies or email addresses. */
    payload: jsonb("payload").notNull(),
    createdAt: createdAt(),
    dispatchedAt: timestamptz("dispatched_at"),
  },
  (table) => [
    // The dispatcher's next batch.
    index("outbox_events_pending_idx")
      .on(table.id)
      .where(sql`${table.dispatchedAt} IS NULL`),
    // Cleanup of dispatched rows.
    index("outbox_events_dispatched_idx")
      .on(table.dispatchedAt)
      .where(sql`${table.dispatchedAt} IS NOT NULL`),
  ],
);

/**
 * One row per notification, channel and recipient. The unique key makes
 * the notification handler idempotent under at-least-once delivery.
 */
export const notificationDeliveries = pgTable(
  "notification_deliveries",
  {
    id: id(),
    /** The outbox event. No foreign key: dispatched events are deleted after a week. */
    eventId: uuid("event_id").notNull(),
    channel: notificationChannel("channel").notNull(),
    recipientCustomerId: uuid("recipient_customer_id").references(
      () => customers.id,
      {
        onDelete: "restrict",
      },
    ),
    recipientAgentId: uuid("recipient_agent_id").references(() => agents.id, {
      onDelete: "restrict",
    }),
    recipientAddress: text("recipient_address").notNull(),
    template: text("template").notNull(),
    ticketId: uuid("ticket_id").references(() => tickets.id, {
      onDelete: "restrict",
    }),
    status: notificationStatus("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    providerMessageId: text("provider_message_id"),
    lastError: text("last_error"),
    createdAt: createdAt(),
    sentAt: timestamptz("sent_at"),
  },
  (table) => [
    unique("notification_deliveries_event_channel_recipient_key").on(
      table.eventId,
      table.channel,
      table.recipientAddress,
    ),
    // Finding failed deliveries.
    index("notification_deliveries_status_idx").on(
      table.status,
      table.createdAt,
    ),
  ],
);
