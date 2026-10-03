import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { seedBulkTickets } from "../src/seed/index.js";
import {
  asOwner,
  createSeededDatabase,
  SEED_ANCHOR,
  type TestDatabase,
} from "../src/testing/index.js";

const TICKETS = 1_000;

/** Bulk tickets for the NFR-1 measurements, on top of the demo seed. */
describe("bulk tickets", () => {
  let database: TestDatabase;
  let result: Awaited<ReturnType<typeof seedBulkTickets>>;

  beforeAll(async () => {
    database = await createSeededDatabase("dsd_test_bulk");
    result = await seedBulkTickets(database.pool("dsd_migrator"), {
      tickets: TICKETS,
      anchor: SEED_ANCHOR,
    });
  });

  afterAll(async () => {
    await database.drop();
  });

  it("adds the tickets, a customer per five, and their threads and history", async () => {
    expect(result.tickets).toBe(TICKETS);
    expect(result.customers).toBe(TICKETS / 5);
    expect(result.messages).toBeGreaterThan(TICKETS * 3);
    expect(result.auditEvents).toBeGreaterThan(result.messages + TICKETS);
    const [counts] = await asOwner<{ tickets: number; demo: number }>(
      database,
      "SELECT count(*)::int AS tickets, count(*) FILTER (WHERE description NOT LIKE 'Generated%')::int AS demo FROM tickets",
    );
    expect(counts).toEqual({ tickets: TICKETS + 60, demo: 60 });
  });

  it("mixes every status and priority roughly as planned, with most tickets assigned", async () => {
    const rows = await asOwner<{ status: string; share: number }>(
      database,
      "SELECT status::text, round(100.0 * count(*) / $1)::int AS share FROM tickets WHERE description LIKE 'Generated%' GROUP BY status ORDER BY status",
      [TICKETS],
    );
    const share = Object.fromEntries(
      rows.map((row) => [row.status, row.share]),
    );
    expect(share.open).toBeGreaterThan(20);
    expect(share.pending_customer).toBeGreaterThan(8);
    expect(share.resolved).toBeGreaterThan(15);
    expect(share.closed).toBeGreaterThan(20);
    const [priorities] = await asOwner<{ kinds: number; assigned: number }>(
      database,
      "SELECT count(DISTINCT priority)::int AS kinds, round(100.0 * count(assignee_agent_id) / count(*))::int AS assigned FROM tickets WHERE description LIKE 'Generated%'",
    );
    expect(priorities?.kinds).toBe(4);
    expect(priorities?.assigned).toBeGreaterThan(45);
    expect(priorities?.assigned).toBeLessThan(75);
  });

  it("gives every ticket a reference from the trigger, and keeps every time before the anchor", async () => {
    const [row] = await asOwner<{
      bad_references: number;
      future: number;
      long_threads: number;
    }>(
      database,
      `SELECT (SELECT count(*) FROM tickets WHERE reference !~ '^DSD-[0-9]{6}$')::int AS bad_references,
              ((SELECT count(*) FROM tickets WHERE created_at > $1 OR updated_at > $1 OR first_response_at > $1)
               + (SELECT count(*) FROM messages WHERE created_at > $1)
               + (SELECT count(*) FROM audit_events WHERE created_at > $1))::int AS future,
              (SELECT count(*) FROM (SELECT ticket_id FROM messages GROUP BY ticket_id HAVING count(*) >= 60) AS t)::int AS long_threads`,
      [SEED_ANCHOR],
    );
    expect(row).toEqual({ bad_references: 0, future: 0, long_threads: 2 });
  });

  it("writes threads only agents and customers of the ticket could have written", async () => {
    const [row] = await asOwner<{ strangers: number; customer_notes: number }>(
      database,
      `SELECT (SELECT count(*) FROM messages m JOIN tickets t ON t.id = m.ticket_id
                WHERE m.author_type = 'customer' AND m.author_customer_id <> t.customer_id)::int AS strangers,
              (SELECT count(*) FROM messages WHERE author_type = 'customer' AND visibility = 'internal')::int AS customer_notes`,
    );
    expect(row).toEqual({ strangers: 0, customer_notes: 0 });
  });

  it("refuses to run twice, because history can't be taken back out", async () => {
    await expect(
      seedBulkTickets(database.pool("dsd_migrator"), { tickets: 10 }),
    ).rejects.toThrow(/already in this database/);
  });
});
