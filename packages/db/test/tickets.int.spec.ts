import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  createTestDatabase,
  expectPgError,
  inRolledBackTransaction,
  SQLSTATE,
  type TestDatabase,
} from "../src/testing/index.js";
import * as fixture from "./fixtures.js";

describe("tickets", () => {
  let db: TestDatabase;

  beforeAll(async () => {
    db = await createTestDatabase("dsd_test_tickets");
  });

  afterAll(async () => {
    await db.drop();
  });

  describe("reference", () => {
    it("is the brand prefix and the number, padded to six digits", async () => {
      await inRolledBackTransaction(db.pool("dsd_migrator"), async (client) => {
        const { ticketId } = await fixture.scenario(client);
        const { rows } = await client.query<{
          number: string;
          reference: string;
        }>("SELECT number, reference FROM tickets WHERE id = $1", [ticketId]);
        const row = rows[0];
        expect(row?.reference).toBe(
          `DSD-${String(row?.number).padStart(6, "0")}`,
        );
      });
    });

    it("grows past six digits instead of truncating", async () => {
      await inRolledBackTransaction(db.pool("dsd_migrator"), async (client) => {
        const brandId = await fixture.brand(client, "ACME");
        const customerId = await fixture.customer(client);
        const { rows } = await client.query<{ reference: string }>(
          "INSERT INTO tickets (number, brand_id, customer_id, channel, subject, description) VALUES (1234567, $1, $2, 'web', 'Subject', 'Description') RETURNING reference",
          [brandId, customerId],
        );
        expect(rows[0]?.reference).toBe("ACME-1234567");
      });
    });

    it("ignores a reference supplied by the caller", async () => {
      await inRolledBackTransaction(db.pool("dsd_api"), async (client) => {
        const owner = await db.pool("dsd_migrator").connect();
        let brandId: string;
        let customerId: string;
        try {
          brandId = await fixture.brand(owner, "SPOOF");
          customerId = await fixture.customer(owner);
        } finally {
          owner.release();
        }
        const { rows } = await client.query<{ reference: string }>(
          "INSERT INTO tickets (reference, brand_id, customer_id, channel, subject, description) VALUES ('DSD-000001', $1, $2, 'web', 'Subject', 'Description') RETURNING reference",
          [brandId, customerId],
        );
        expect(rows[0]?.reference).toMatch(/^SPOOF-\d{6,}$/);
      });
    });

    it("reports an unknown brand as a foreign key violation", async () => {
      await inRolledBackTransaction(db.pool("dsd_migrator"), async (client) => {
        const customerId = await fixture.customer(client);
        const error = await expectPgError(
          client,
          "INSERT INTO tickets (brand_id, customer_id, channel, subject, description) VALUES ('00000000-0000-7000-8000-000000000000', $1, 'web', 'Subject', 'Description')",
          [customerId],
        );
        expect(error.code).toBe(SQLSTATE.foreignKeyViolation);
      });
    });

    it("numbers tickets from a sequence the API may use", async () => {
      await inRolledBackTransaction(db.pool("dsd_migrator"), async (client) => {
        const { brandId, customerId, ticketId } =
          await fixture.scenario(client);
        const second = await fixture.ticket(client, brandId, customerId);
        const { rows } = await client.query<{ id: string; number: string }>(
          "SELECT id, number FROM tickets WHERE id IN ($1, $2)",
          [ticketId, second],
        );
        const numbers = new Map(
          rows.map((row) => [row.id, Number(row.number)]),
        );
        expect(numbers.get(second)).toBe((numbers.get(ticketId) ?? 0) + 1);
      });
    });
  });

  describe("write-once fields", () => {
    const writeOnce = [
      ["reference", "'DSD-999999'"],
      ["number", "999999"],
      ["brand_id", "(SELECT id FROM brands WHERE ticket_prefix = 'OTHER')"],
      ["customer_id", "(SELECT id FROM customers WHERE email LIKE 'other-%')"],
      ["channel", "'email'"],
      ["subject", "'A different subject'"],
      ["description", "'A different description'"],
      ["created_at", "now() - interval '1 day'"],
    ] as const;

    it.each(writeOnce)("refuses a change to %s", async (column, value) => {
      await inRolledBackTransaction(db.pool("dsd_migrator"), async (client) => {
        const { ticketId } = await fixture.scenario(client);
        await fixture.brand(client, "OTHER");
        await client.query(
          "INSERT INTO customers (email, email_normalized) VALUES ('other-1@example.com', 'other-1@example.com')",
        );
        const error = await expectPgError(
          client,
          `UPDATE tickets SET ${column} = ${value} WHERE id = $1`,
          [ticketId],
        );
        expect(error.code).toBe(SQLSTATE.raiseException);
        expect(error.message).toBe(
          `tickets.${column} cannot change after the ticket is created`,
        );
      });
    });

    it("allows the fields that do change, and names every write-once field in one error", async () => {
      await inRolledBackTransaction(db.pool("dsd_api"), async (client) => {
        const owner = await db.pool("dsd_migrator").connect();
        let ids: Awaited<ReturnType<typeof fixture.scenario>>;
        try {
          ids = await fixture.scenario(owner);
        } finally {
          owner.release();
        }
        await client.query(
          "UPDATE tickets SET status = 'pending_customer', priority = 'high', assignee_agent_id = $2, updated_at = now() WHERE id = $1",
          [ids.ticketId, ids.agentId],
        );
        const error = await expectPgError(
          client,
          "UPDATE tickets SET subject = 'x', description = 'y' WHERE id = $1",
          [ids.ticketId],
        );
        expect(error.message).toBe(
          "tickets.subject, description cannot change after the ticket is created",
        );
      });
    });
  });
});
