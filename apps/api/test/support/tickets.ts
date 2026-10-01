import type { TestDatabase } from "@dsd/db/testing";
import type { TicketChannel, TicketPriority, TicketStatus } from "@dsd/shared";

import { asOwner } from "./database.js";

export interface NewTicket {
  customerId: string;
  /** Defaults to the seeded demo brand. */
  brandId?: string;
  status?: TicketStatus;
  priority?: TicketPriority;
  assigneeId?: string | null;
  subject?: string;
  channel?: TicketChannel;
}

/** The seeded demo brand's ID. */
export async function demoBrandId(database: TestDatabase): Promise<string> {
  const [row] = await asOwner<{ id: string }>(
    database,
    "SELECT id FROM brands WHERE slug = 'dsd'",
  );
  if (row === undefined) throw new Error("the seed has no demo brand");
  return row.id;
}

/**
 * A ticket written straight to the database as the schema owner, for tests
 * about what happens to a ticket rather than how it was submitted. It has
 * no history: tests that need one go through the API.
 */
export async function newTicket(
  database: TestDatabase,
  ticket: NewTicket,
): Promise<string> {
  const status = ticket.status ?? "open";
  const [row] = await asOwner<{ id: string }>(
    database,
    `INSERT INTO tickets (brand_id, customer_id, channel, subject, description,
                          status, priority, assignee_agent_id, resolved_at, closed_at)
     VALUES ($1, $2, $7::ticket_channel, $3, 'Written by a test.', $4::ticket_status,
             $5::ticket_priority, $6,
             CASE WHEN $4::ticket_status IN ('resolved', 'closed') THEN now() END,
             CASE WHEN $4::ticket_status = 'closed' THEN now() END)
     RETURNING id`,
    [
      ticket.brandId ?? (await demoBrandId(database)),
      ticket.customerId,
      ticket.subject ?? "A ticket made by a test",
      status,
      ticket.priority ?? "normal",
      ticket.assigneeId ?? null,
      ticket.channel ?? "web",
    ],
  );
  if (row === undefined) throw new Error("ticket insert returned nothing");
  return row.id;
}

/**
 * A second brand with no members, for brand-scope tests (ADR-0004, section
 * 6). Created once per database.
 */
export async function otherBrandId(database: TestDatabase): Promise<string> {
  const [row] = await asOwner<{ id: string }>(
    database,
    `INSERT INTO brands (slug, name, ticket_prefix, support_email)
     VALUES ('other', 'Other Brand', 'OTH', 'support@other.example')
     ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name
     RETURNING id`,
  );
  if (row === undefined) throw new Error("brand insert returned nothing");
  return row.id;
}
