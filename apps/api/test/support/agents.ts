import { randomUUID } from "node:crypto";

import type { TestDatabase } from "@dsd/db/testing";
import type { AgentRole } from "@dsd/shared";

import { asOwner } from "./database.js";
import { demoBrandId } from "./tickets.js";

export interface NewAgent {
  role?: AgentRole;
  /** Defaults to true. */
  active?: boolean;
  /** False leaves them invited: no password yet. Defaults to true. */
  hasPassword?: boolean;
  /** Defaults to the seeded demo brand. */
  brandIds?: string[];
}

/**
 * A staff account written straight to the database as the schema owner,
 * with a unique email, for tests that change or deactivate someone without
 * touching the seeded accounts other tests sign in as.
 */
export async function newAgent(
  database: TestDatabase,
  agent: NewAgent = {},
): Promise<{ id: string; email: string }> {
  const email = `agent-${randomUUID()}@dsd.example`;
  const [row] = await asOwner<{ id: string }>(
    database,
    `INSERT INTO agents (email, email_normalized, display_name, role, password_hash, deactivated_at)
     VALUES ($1, $1, 'Test Agent', $2::agent_role,
             CASE WHEN $3 THEN 'not-a-real-hash' END,
             CASE WHEN $4 THEN NULL ELSE now() END)
     RETURNING id`,
    [
      email,
      agent.role ?? "agent",
      agent.hasPassword ?? true,
      agent.active ?? true,
    ],
  );
  if (row === undefined) throw new Error("agent insert returned nothing");
  for (const brandId of agent.brandIds ?? [await demoBrandId(database)]) {
    await asOwner(
      database,
      "INSERT INTO agent_brand_memberships (agent_id, brand_id) VALUES ($1, $2)",
      [row.id, brandId],
    );
  }
  return { id: row.id, email };
}
