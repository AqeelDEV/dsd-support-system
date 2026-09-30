import { sql } from "drizzle-orm";
import { pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";

import { brands } from "./brands.js";
import { createdAt, id, timestamptz, updatedAt } from "./columns.js";
import { agents } from "./identity.js";

/**
 * Reply templates (FR-12). Variables such as `{{customer.name}}` are filled
 * in by the API, and the agent can edit the result before sending.
 * Retiring hides a template without deleting it.
 */
export const cannedResponses = pgTable(
  "canned_responses",
  {
    id: id(),
    brandId: uuid("brand_id")
      .notNull()
      .references(() => brands.id, { onDelete: "restrict" }),
    title: text("title").notNull(),
    body: text("body").notNull(),
    createdByAgentId: uuid("created_by_agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "restrict" }),
    updatedByAgentId: uuid("updated_by_agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "restrict" }),
    retiredAt: timestamptz("retired_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    // No two active templates with the same title in a brand.
    uniqueIndex("canned_responses_active_title_key")
      .on(table.brandId, table.title)
      .where(sql`${table.retiredAt} IS NULL`),
  ],
);
