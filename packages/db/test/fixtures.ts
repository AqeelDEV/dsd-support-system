import { randomUUID } from "node:crypto";

import type { PoolClient } from "pg";

/**
 * Minimal valid rows for tests, inserted with plain SQL so each test shows
 * exactly what it writes. Every helper returns the new row's ID.
 */

async function insert(
  client: PoolClient,
  sql: string,
  values: unknown[],
): Promise<string> {
  const result = await client.query<{ id: string }>(
    `${sql} RETURNING id`,
    values,
  );
  const id = result.rows[0]?.id;
  if (id === undefined) throw new Error("insert returned no row");
  return id;
}

const unique = () => randomUUID().slice(0, 8);

export async function brand(
  client: PoolClient,
  prefix = "DSD",
): Promise<string> {
  const slug = `brand-${unique()}`;
  return insert(
    client,
    "INSERT INTO brands (slug, name, ticket_prefix, support_email) VALUES ($1, $2, $3, $4)",
    [slug, `Brand ${slug}`, prefix, `support@${slug}.example`],
  );
}

export async function customer(client: PoolClient): Promise<string> {
  const email = `customer-${unique()}@example.com`;
  return insert(
    client,
    "INSERT INTO customers (email, email_normalized) VALUES ($1, $1)",
    [email],
  );
}

export async function agent(
  client: PoolClient,
  role: "agent" | "supervisor" | "admin" = "agent",
): Promise<string> {
  const email = `agent-${unique()}@dsd.example`;
  return insert(
    client,
    "INSERT INTO agents (email, email_normalized, display_name, role) VALUES ($1, $1, 'Test Agent', $2)",
    [email, role],
  );
}

export async function ticket(
  client: PoolClient,
  brandId: string,
  customerId: string,
): Promise<string> {
  return insert(
    client,
    "INSERT INTO tickets (brand_id, customer_id, channel, subject, description) VALUES ($1, $2, 'web', 'Card declined at checkout', 'My card was declined twice.')",
    [brandId, customerId],
  );
}

export async function customerMessage(
  client: PoolClient,
  ticketId: string,
  customerId: string,
): Promise<string> {
  return insert(
    client,
    "INSERT INTO messages (ticket_id, author_type, author_customer_id, visibility, body) VALUES ($1, 'customer', $2, 'public', 'Any update?')",
    [ticketId, customerId],
  );
}

export async function auditEvent(
  client: PoolClient,
  ticketId: string,
): Promise<string> {
  return insert(
    client,
    "INSERT INTO audit_events (ticket_id, entity_type, entity_id, action, actor_type, request_id) VALUES ($1, 'ticket', $1, 'ticket.created', 'system', 'test')",
    [ticketId],
  );
}

export async function aiSuggestion(
  client: PoolClient,
  ticketId: string,
): Promise<string> {
  return insert(
    client,
    "INSERT INTO ai_suggestions (ticket_id, trigger_event_id, provider, model, prompt_version, retrieval_mode, status, draft_body) VALUES ($1, $2, 'mock', 'mock-1', 'reply-draft/v1', 'hybrid', 'ready', 'Here is how to fix it.')",
    [ticketId, randomUUID()],
  );
}

/** A brand, a customer, an agent and one ticket: the base most tests need. */
export async function scenario(client: PoolClient) {
  const brandId = await brand(client);
  const customerId = await customer(client);
  const agentId = await agent(client);
  const ticketId = await ticket(client, brandId, customerId);
  return { brandId, customerId, agentId, ticketId };
}
