import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  text,
  uuid,
} from "drizzle-orm/pg-core";

import { aiSuggestions } from "./ai-suggestions.js";
import { bytea, createdAt, id } from "./columns.js";
import { messageVisibility, participantType } from "./enums.js";
import { agents, customers } from "./identity.js";
import { tickets } from "./tickets.js";

/**
 * The conversation on a ticket, after its description. Append-only:
 * triggers reject UPDATE, DELETE and TRUNCATE for every role, and the
 * worker's database role can't insert here at all (ADR-0008).
 */
export const messages = pgTable(
  "messages",
  {
    id: id(),
    ticketId: uuid("ticket_id")
      .notNull()
      .references(() => tickets.id, { onDelete: "restrict" }),
    authorType: participantType("author_type").notNull(),
    authorCustomerId: uuid("author_customer_id").references(
      () => customers.id,
      {
        onDelete: "restrict",
      },
    ),
    authorAgentId: uuid("author_agent_id").references(() => agents.id, {
      onDelete: "restrict",
    }),
    /** `internal` is an internal note: never shown or sent to the customer (FR-10). */
    visibility: messageVisibility("visibility").notNull(),
    body: text("body").notNull(),
    /** Set when an agent sent a reply built from an AI suggestion (FR-21). */
    aiSuggestionId: uuid("ai_suggestion_id"),
    approvedByAgentId: uuid("approved_by_agent_id").references(
      () => agents.id,
      {
        onDelete: "restrict",
      },
    ),
    createdAt: createdAt(),
  },
  (table) => [
    check(
      "messages_author_ck",
      sql`(${table.authorType} = 'customer' AND ${table.authorCustomerId} IS NOT NULL AND ${table.authorAgentId} IS NULL) OR (${table.authorType} = 'agent' AND ${table.authorAgentId} IS NOT NULL AND ${table.authorCustomerId} IS NULL)`,
    ),
    // Customers can't write internal notes.
    check(
      "messages_customer_public_ck",
      sql`${table.authorType} <> 'customer' OR ${table.visibility} = 'public'`,
    ),
    // The AI guardrail in the database: a message built from a suggestion
    // must name the agent who approved it...
    check(
      "messages_ai_approval_ck",
      sql`${table.aiSuggestionId} IS NULL OR ${table.approvedByAgentId} IS NOT NULL`,
    ),
    // ...and that agent must be the one sending it.
    check(
      "messages_approver_is_author_ck",
      sql`${table.approvedByAgentId} IS NULL OR ${table.approvedByAgentId} = ${table.authorAgentId}`,
    ),
    check(
      "messages_body_length_ck",
      sql`char_length(${table.body}) BETWEEN 1 AND 20000`,
    ),
    // A suggestion can only be used on the ticket it was generated for.
    foreignKey({
      name: "messages_ai_suggestion_fk",
      columns: [table.aiSuggestionId, table.ticketId],
      foreignColumns: [aiSuggestions.id, aiSuggestions.ticketId],
    }).onDelete("restrict"),
    // Loading a thread in order.
    index("messages_thread_idx").on(table.ticketId, table.createdAt, table.id),
  ],
);

/**
 * Files on a ticket or on one of its messages (ADR-0009). An attachment
 * inherits the visibility of its message. The object key is random and
 * never derived from the filename.
 */
export const attachments = pgTable(
  "attachments",
  {
    id: id(),
    ticketId: uuid("ticket_id")
      .notNull()
      .references(() => tickets.id, { onDelete: "restrict" }),
    /** Empty for files attached to the ticket itself. */
    messageId: uuid("message_id").references(() => messages.id, {
      onDelete: "restrict",
    }),
    uploaderType: participantType("uploader_type").notNull(),
    uploaderCustomerId: uuid("uploader_customer_id").references(
      () => customers.id,
      {
        onDelete: "restrict",
      },
    ),
    uploaderAgentId: uuid("uploader_agent_id").references(() => agents.id, {
      onDelete: "restrict",
    }),
    objectKey: text("object_key")
      .notNull()
      .unique("attachments_object_key_key"),
    /** Cleaned, for display and as the download name only. */
    filename: text("filename").notNull(),
    /** Detected from the file's bytes, never taken from the upload. */
    contentType: text("content_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    sha256: bytea("sha256").notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    check(
      "attachments_uploader_ck",
      sql`(${table.uploaderType} = 'customer' AND ${table.uploaderCustomerId} IS NOT NULL AND ${table.uploaderAgentId} IS NULL) OR (${table.uploaderType} = 'agent' AND ${table.uploaderAgentId} IS NOT NULL AND ${table.uploaderCustomerId} IS NULL)`,
    ),
    check(
      "attachments_size_ck",
      sql`${table.sizeBytes} BETWEEN 1 AND 10485760`,
    ),
    index("attachments_ticket_idx").on(table.ticketId),
    index("attachments_message_idx").on(table.messageId),
  ],
);
