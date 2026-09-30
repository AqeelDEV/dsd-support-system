import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  index,
  pgSequence,
  pgTable,
  text,
  uuid,
} from "drizzle-orm/pg-core";

import { brands } from "./brands.js";
import { createdAt, id, timestamptz, updatedAt } from "./columns.js";
import { ticketChannel, ticketPriority, ticketStatus } from "./enums.js";
import { agents, customers } from "./identity.js";

/** Source of the human-friendly ticket number. */
export const ticketNumberSeq = pgSequence("ticket_number_seq");

/**
 * `reference` is always built by the `tickets_set_reference` trigger from
 * the brand's prefix and `number`, whatever the insert supplies. The ORM
 * fills this placeholder only so the column can stay NOT NULL.
 */
export const REFERENCE_SET_BY_DATABASE = "";

export const tickets = pgTable(
  "tickets",
  {
    id: id(),
    number: bigint("number", { mode: "number" })
      .notNull()
      .unique("tickets_number_key")
      .default(sql`nextval('ticket_number_seq')`),
    /** For example `DSD-000123`. URLs use `id`; people use this. */
    reference: text("reference")
      .notNull()
      .unique("tickets_reference_key")
      .$defaultFn(() => REFERENCE_SET_BY_DATABASE),
    brandId: uuid("brand_id")
      .notNull()
      .references(() => brands.id, { onDelete: "restrict" }),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "restrict" }),
    /** How the ticket arrived: an attribute, never a table per channel (FR-6). */
    channel: ticketChannel("channel").notNull(),
    subject: text("subject").notNull(),
    description: text("description").notNull(),
    status: ticketStatus("status").notNull().default("open"),
    priority: ticketPriority("priority").notNull().default("normal"),
    assigneeAgentId: uuid("assignee_agent_id").references(() => agents.id, {
      onDelete: "restrict",
    }),
    /** Set when the customer proves they own the email by opening a link we sent. */
    contactVerifiedAt: timestamptz("contact_verified_at"),
    escalatedAt: timestamptz("escalated_at"),
    escalatedByAgentId: uuid("escalated_by_agent_id").references(
      () => agents.id,
      {
        onDelete: "restrict",
      },
    ),
    firstResponseAt: timestamptz("first_response_at"),
    /** The latest resolution; cleared when the ticket reopens (ADR-0007). */
    resolvedAt: timestamptz("resolved_at"),
    closedAt: timestamptz("closed_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    check(
      "tickets_subject_length_ck",
      sql`char_length(${table.subject}) BETWEEN 1 AND 200`,
    ),
    check(
      "tickets_description_length_ck",
      sql`char_length(${table.description}) BETWEEN 1 AND 20000`,
    ),
    check(
      "tickets_resolved_at_ck",
      sql`${table.resolvedAt} IS NULL OR ${table.status} IN ('resolved', 'closed')`,
    ),
    check(
      "tickets_closed_at_ck",
      sql`(${table.status} = 'closed') = (${table.closedAt} IS NOT NULL)`,
    ),
    check(
      "tickets_first_response_ck",
      sql`${table.firstResponseAt} IS NULL OR ${table.firstResponseAt} >= ${table.createdAt}`,
    ),
    check(
      "tickets_escalation_ck",
      sql`(${table.escalatedAt} IS NULL) = (${table.escalatedByAgentId} IS NULL)`,
    ),
    // The queue filtered by status, sorted by priority then age (FR-7).
    index("tickets_queue_idx").on(
      table.brandId,
      table.status,
      table.priority.desc().nullsFirst(),
      table.createdAt,
    ),
    // The queue by age across statuses; ticket volume reporting (FR-13).
    index("tickets_brand_created_idx").on(table.brandId, table.createdAt),
    // "My tickets" and tickets per agent.
    index("tickets_assignee_idx")
      .on(table.assigneeAgentId, table.status)
      .where(sql`${table.assigneeAgentId} IS NOT NULL`),
    // A customer's own tickets (FR-3) and their other tickets in the agent view (FR-8).
    index("tickets_customer_idx").on(
      table.customerId,
      table.createdAt.desc().nullsFirst(),
    ),
    index("tickets_escalated_idx")
      .on(table.brandId, table.escalatedAt)
      .where(sql`${table.escalatedAt} IS NOT NULL`),
    // Time to resolution, reported by resolution date.
    index("tickets_resolved_idx")
      .on(table.brandId, table.resolvedAt)
      .where(sql`${table.resolvedAt} IS NOT NULL`),
  ],
);
