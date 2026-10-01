import { pgView, text, uuid } from "drizzle-orm/pg-core";

import { timestamptz } from "./columns.js";

/**
 * Public agent replies, the only message text the worker may read: it
 * quotes them in notification emails. Created by migration 0004 (the author added in 0005) and owned
 * by the migrator; `.existing()` tells drizzle-kit not to manage it. The
 * worker has no privilege on `messages` itself, so it can never read an
 * internal note or a customer's message (ADR-0006, ADR-0008).
 */
export const publicReplyBodies = pgView("public_reply_bodies", {
  id: uuid("id").notNull(),
  ticketId: uuid("ticket_id").notNull(),
  body: text("body").notNull(),
  createdAt: timestamptz("created_at").notNull(),
  /** Who sent the reply, so the email can name them (migration 0005). */
  authorAgentId: uuid("author_agent_id").notNull(),
}).existing();
