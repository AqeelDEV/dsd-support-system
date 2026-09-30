import { sql } from "drizzle-orm";
import { check, index, inet, pgTable, text, uuid } from "drizzle-orm/pg-core";

import { bytea, createdAt, id, timestamptz } from "./columns.js";
import { authTokenPurpose, sessionRealm } from "./enums.js";
import { agents, customers } from "./identity.js";
import { tickets } from "./tickets.js";

/**
 * Opaque sessions (ADR-0003). Only the SHA-256 of each token is stored, so
 * a database leak hands out no live sessions. A guest session is a
 * customer-realm session limited to one ticket by `guest_ticket_id`.
 */
export const sessions = pgTable(
  "sessions",
  {
    id: id(),
    realm: sessionRealm("realm").notNull(),
    tokenHash: bytea("token_hash").notNull().unique("sessions_token_hash_key"),
    customerId: uuid("customer_id").references(() => customers.id, {
      onDelete: "restrict",
    }),
    agentId: uuid("agent_id").references(() => agents.id, {
      onDelete: "restrict",
    }),
    guestTicketId: uuid("guest_ticket_id").references(() => tickets.id, {
      onDelete: "restrict",
    }),
    ip: inet("ip"),
    userAgent: text("user_agent"),
    createdAt: createdAt(),
    lastSeenAt: timestamptz("last_seen_at").notNull().defaultNow(),
    idleExpiresAt: timestamptz("idle_expires_at").notNull(),
    expiresAt: timestamptz("expires_at").notNull(),
    revokedAt: timestamptz("revoked_at"),
  },
  (table) => [
    // The realm on the row must match its identity, so a customer session
    // can never carry an agent (FR-17).
    check(
      "sessions_realm_ck",
      sql`(${table.realm} = 'customer' AND ${table.customerId} IS NOT NULL AND ${table.agentId} IS NULL) OR (${table.realm} = 'staff' AND ${table.agentId} IS NOT NULL AND ${table.customerId} IS NULL AND ${table.guestTicketId} IS NULL)`,
    ),
    check("sessions_expiry_ck", sql`${table.expiresAt} > ${table.createdAt}`),
    index("sessions_expires_at_idx").on(table.expiresAt),
    index("sessions_agent_idx")
      .on(table.agentId)
      .where(sql`${table.revokedAt} IS NULL`),
    index("sessions_customer_idx")
      .on(table.customerId)
      .where(sql`${table.revokedAt} IS NULL`),
  ],
);

/**
 * One-off tokens for guest links, signup verification, agent invites and
 * password resets. The worker creates the row when it sends the email that
 * carries the token, so the raw token exists only in that email.
 */
export const authTokens = pgTable(
  "auth_tokens",
  {
    id: id(),
    purpose: authTokenPurpose("purpose").notNull(),
    tokenHash: bytea("token_hash")
      .notNull()
      .unique("auth_tokens_token_hash_key"),
    customerId: uuid("customer_id").references(() => customers.id, {
      onDelete: "restrict",
    }),
    agentId: uuid("agent_id").references(() => agents.id, {
      onDelete: "restrict",
    }),
    ticketId: uuid("ticket_id").references(() => tickets.id, {
      onDelete: "restrict",
    }),
    expiresAt: timestamptz("expires_at").notNull(),
    /** Set when a single-use token is used. */
    consumedAt: timestamptz("consumed_at"),
    /** Guest links can be reused until they expire. */
    lastUsedAt: timestamptz("last_used_at"),
    createdAt: createdAt(),
  },
  (table) => [
    check(
      "auth_tokens_subject_ck",
      sql`(${table.purpose} = 'guest_ticket_access' AND ${table.ticketId} IS NOT NULL AND ${table.customerId} IS NOT NULL AND ${table.agentId} IS NULL) OR (${table.purpose} IN ('customer_signup', 'password_reset') AND ${table.customerId} IS NOT NULL AND ${table.agentId} IS NULL AND ${table.ticketId} IS NULL) OR (${table.purpose} = 'agent_invite' AND ${table.agentId} IS NOT NULL AND ${table.customerId} IS NULL AND ${table.ticketId} IS NULL)`,
    ),
    index("auth_tokens_expires_at_idx").on(table.expiresAt),
  ],
);
