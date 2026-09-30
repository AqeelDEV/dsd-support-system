import { sql } from "drizzle-orm";
import { check, index, jsonb, pgTable, text, uuid } from "drizzle-orm/pg-core";

import { createdAt, id } from "./columns.js";
import { actorType } from "./enums.js";
import { agents, customers } from "./identity.js";
import { tickets } from "./tickets.js";

/**
 * The immutable history (FR-18). Append-only: triggers reject UPDATE,
 * DELETE and TRUNCATE for every role (ADR-0008). Every change writes its
 * event in the same transaction as the change.
 */
export const auditEvents = pgTable(
  "audit_events",
  {
    id: id(),
    /** Empty for events that aren't about a ticket, such as a role change. */
    ticketId: uuid("ticket_id").references(() => tickets.id, {
      onDelete: "restrict",
    }),
    entityType: text("entity_type").notNull(),
    entityId: uuid("entity_id").notNull(),
    /** One of AUDIT_ACTIONS in @dsd/shared. */
    action: text("action").notNull(),
    actorType: actorType("actor_type").notNull(),
    actorCustomerId: uuid("actor_customer_id").references(() => customers.id, {
      onDelete: "restrict",
    }),
    actorAgentId: uuid("actor_agent_id").references(() => agents.id, {
      onDelete: "restrict",
    }),
    /** Only the fields that changed. Message bodies are never copied here. */
    before: jsonb("before"),
    after: jsonb("after"),
    /** Links the event to the API request and its logs. */
    requestId: text("request_id").notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    check(
      "audit_events_actor_ck",
      sql`(${table.actorType} = 'system' AND ${table.actorCustomerId} IS NULL AND ${table.actorAgentId} IS NULL) OR (${table.actorType} = 'customer' AND ${table.actorCustomerId} IS NOT NULL AND ${table.actorAgentId} IS NULL) OR (${table.actorType} = 'agent' AND ${table.actorAgentId} IS NOT NULL AND ${table.actorCustomerId} IS NULL)`,
    ),
    // A ticket's history and the customer's status timeline.
    index("audit_events_ticket_idx").on(table.ticketId, table.createdAt),
    // History of other entities, such as an agent's role changes.
    index("audit_events_entity_idx").on(
      table.entityType,
      table.entityId,
      table.createdAt,
    ),
  ],
);
