import type { TestDatabase } from "@dsd/db/testing";
import type { AuthTokenPurpose } from "@dsd/shared";

import { generateToken, hashToken } from "../../src/auth/tokens.js";

export interface IssuedLink {
  token: string;
}

/**
 * Creates an emailed-link token the way the worker will in Phase 6, when
 * it sends the email: as the `dsd_worker` role, which may insert tokens
 * but never read them back. Returns the raw token, which in real use exists
 * only in the email.
 */
export async function issueLinkToken(
  database: TestDatabase,
  link: {
    purpose: AuthTokenPurpose;
    customerId?: string;
    agentId?: string;
    ticketId?: string;
    /** Negative for a link that has already expired. */
    validForMinutes?: number;
  },
): Promise<IssuedLink> {
  const token = generateToken();
  await database.pool("dsd_worker").query(
    `INSERT INTO auth_tokens (purpose, token_hash, customer_id, agent_id, ticket_id, expires_at)
     VALUES ($1, $2, $3, $4, $5, now() + make_interval(mins => $6))`,
    [
      link.purpose,
      hashToken(token),
      link.customerId ?? null,
      link.agentId ?? null,
      link.ticketId ?? null,
      link.validForMinutes ?? 60,
    ],
  );
  return { token };
}
