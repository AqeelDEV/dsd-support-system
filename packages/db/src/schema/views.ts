import { pgView, text, uuid } from "drizzle-orm/pg-core";

import { timestamptz } from "./columns.js";

/**
 * Public agent replies, which the worker quotes in notification emails.
 * Created by migration 0004 (the author added in 0005) and owned by the
 * migrator; `.existing()` tells drizzle-kit not to manage it. The worker has
 * no privilege on `messages` itself, so it can never read an internal note
 * through this view (ADR-0006, ADR-0008).
 */
export const publicReplyBodies = pgView("public_reply_bodies", {
  id: uuid("id").notNull(),
  ticketId: uuid("ticket_id").notNull(),
  body: text("body").notNull(),
  createdAt: timestamptz("created_at").notNull(),
  /** Who sent the reply, so the email can name them (migration 0005). */
  authorAgentId: uuid("author_agent_id").notNull(),
}).existing();

/**
 * Customers' own messages, which the AI pipeline reads to draft a reply
 * (migration 0006). Like the view above it is owned by the migrator and
 * the worker's grant is on the view alone, so the only message text the
 * worker can read is what customers wrote and what agents sent them:
 * internal notes never reach a prompt or an email by any query.
 */
export const publicCustomerMessages = pgView("public_customer_messages", {
  id: uuid("id").notNull(),
  ticketId: uuid("ticket_id").notNull(),
  body: text("body").notNull(),
  createdAt: timestamptz("created_at").notNull(),
}).existing();
