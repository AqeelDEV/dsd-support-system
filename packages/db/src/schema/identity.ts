import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  check,
  pgTable,
  primaryKey,
  text,
  uuid,
} from "drizzle-orm/pg-core";

import { brands } from "./brands.js";
import { createdAt, id, timestamptz, updatedAt } from "./columns.js";
import { agentRole } from "./enums.js";

/**
 * Everyone who has raised a ticket or registered. A guest has no password;
 * registering later sets one on the same row, which is why earlier guest
 * tickets appear in the new account without any merging (ADR-0003).
 */
export const customers = pgTable(
  "customers",
  {
    id: id(),
    email: text("email").notNull(),
    /** Trimmed and lowercased; carries the uniqueness. */
    emailNormalized: text("email_normalized")
      .notNull()
      .unique("customers_email_normalized_key"),
    displayName: text("display_name"),
    passwordHash: text("password_hash"),
    emailVerifiedAt: timestamptz("email_verified_at"),
    lastLoginAt: timestamptz("last_login_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    // No password on an unverified email: nobody can set a password for an
    // inbox they haven't proven they control (account pre-hijacking).
    check(
      "customers_password_needs_verified_ck",
      sql`${table.passwordHash} IS NULL OR ${table.emailVerifiedAt} IS NOT NULL`,
    ),
  ],
);

/** All staff. The role is a column; permissions come from it in code (ADR-0004). */
export const agents = pgTable("agents", {
  id: id(),
  email: text("email").notNull(),
  emailNormalized: text("email_normalized")
    .notNull()
    .unique("agents_email_normalized_key"),
  displayName: text("display_name").notNull(),
  role: agentRole("role").notNull(),
  /** Empty until the agent accepts their invite. */
  passwordHash: text("password_hash"),
  invitedByAgentId: uuid("invited_by_agent_id").references(
    (): AnyPgColumn => agents.id,
    {
      onDelete: "restrict",
    },
  ),
  /** The single source of "is this agent active". */
  deactivatedAt: timestamptz("deactivated_at"),
  lastLoginAt: timestamptz("last_login_at"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/** Which brands each agent works in. Every staff query filters by these. */
export const agentBrandMemberships = pgTable(
  "agent_brand_memberships",
  {
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "restrict" }),
    brandId: uuid("brand_id")
      .notNull()
      .references(() => brands.id, { onDelete: "restrict" }),
    createdAt: createdAt(),
  },
  (table) => [primaryKey({ columns: [table.agentId, table.brandId] })],
);
