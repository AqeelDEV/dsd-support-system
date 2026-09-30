import { sql } from "drizzle-orm";
import { check, pgTable, text } from "drizzle-orm/pg-core";

import { createdAt, id, updatedAt } from "./columns.js";

/**
 * v1 seeds one brand, but every brand-owned row carries `brand_id` from the
 * start, so a second brand is new rows rather than new tables (SRS §11.1).
 */
export const brands = pgTable(
  "brands",
  {
    id: id(),
    slug: text("slug").notNull().unique("brands_slug_key"),
    name: text("name").notNull(),
    /** Prefix of every ticket reference, for example `DSD` in `DSD-000123`. */
    ticketPrefix: text("ticket_prefix")
      .notNull()
      .unique("brands_ticket_prefix_key"),
    /** Sender address for this brand's notifications. */
    supportEmail: text("support_email").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    check(
      "brands_ticket_prefix_ck",
      sql`${table.ticketPrefix} ~ '^[A-Z]{2,8}$'`,
    ),
  ],
);
