import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  createTestDatabase,
  expectPgError,
  inRolledBackTransaction,
  SQLSTATE,
  type TestDatabase,
} from "../src/testing/index.js";
import * as fixture from "./fixtures.js";

/**
 * FR-18: ticket history can't be rewritten, even from psql. The owning role
 * is stopped by the triggers; the API role is stopped earlier by its
 * privileges (ADR-0008).
 */
describe("append-only history", () => {
  let db: TestDatabase;
  let ids: {
    ticketId: string;
    customerId: string;
    messageId: string;
    auditEventId: string;
  };

  beforeAll(async () => {
    db = await createTestDatabase("dsd_test_append_only");
    const client = await db.pool("dsd_migrator").connect();
    try {
      const { ticketId, customerId } = await fixture.scenario(client);
      ids = {
        ticketId,
        customerId,
        messageId: await fixture.customerMessage(client, ticketId, customerId),
        auditEventId: await fixture.auditEvent(client, ticketId),
      };
    } finally {
      client.release();
    }
  });

  afterAll(async () => {
    await db.drop();
  });

  const attempts = [
    {
      table: "messages",
      operation: "UPDATE",
      statement: () =>
        `UPDATE messages SET body = 'rewritten' WHERE id = '${ids.messageId}'`,
    },
    {
      table: "messages",
      operation: "DELETE",
      statement: () => `DELETE FROM messages WHERE id = '${ids.messageId}'`,
    },
    // CASCADE, because attachments reference messages; the trigger still fires.
    {
      table: "messages",
      operation: "TRUNCATE",
      statement: () => "TRUNCATE messages CASCADE",
    },
    {
      table: "audit_events",
      operation: "UPDATE",
      statement: () =>
        `UPDATE audit_events SET action = 'rewritten' WHERE id = '${ids.auditEventId}'`,
    },
    {
      table: "audit_events",
      operation: "DELETE",
      statement: () =>
        `DELETE FROM audit_events WHERE id = '${ids.auditEventId}'`,
    },
    {
      table: "audit_events",
      operation: "TRUNCATE",
      statement: () => "TRUNCATE audit_events",
    },
  ];

  it.each(attempts)(
    "the owning role can't $operation $table: the trigger refuses",
    async ({ table, statement }) => {
      await inRolledBackTransaction(db.pool("dsd_migrator"), async (client) => {
        const error = await expectPgError(client, statement());
        expect(error.code).toBe(SQLSTATE.raiseException);
        expect(error.message).toBe(`${table} is append-only`);
      });
    },
  );

  it.each(attempts)(
    "the API role can't $operation $table: it lacks the privilege",
    async ({ statement }) => {
      await inRolledBackTransaction(db.pool("dsd_api"), async (client) => {
        const error = await expectPgError(client, statement());
        expect(error.code).toBe(SQLSTATE.insufficientPrivilege);
      });
    },
  );

  it("still lets the API append to both", async () => {
    await inRolledBackTransaction(db.pool("dsd_api"), async (client) => {
      await client.query(
        "INSERT INTO messages (ticket_id, author_type, author_customer_id, visibility, body) VALUES ($1, 'customer', $2, 'public', 'Following up')",
        [ids.ticketId, ids.customerId],
      );
      await client.query(
        "INSERT INTO audit_events (ticket_id, entity_type, entity_id, action, actor_type, actor_customer_id, request_id) VALUES ($1, 'message', $1, 'message.created', 'customer', $2, 'test')",
        [ids.ticketId, ids.customerId],
      );
    });
  });

  it("leaves the original rows exactly as they were", async () => {
    const owner = db.pool("dsd_migrator");
    const message = await owner.query(
      "SELECT body FROM messages WHERE id = $1",
      [ids.messageId],
    );
    const event = await owner.query(
      "SELECT action FROM audit_events WHERE id = $1",
      [ids.auditEventId],
    );
    expect(message.rows).toEqual([{ body: "Any update?" }]);
    expect(event.rows).toEqual([{ action: "ticket.created" }]);
  });
});
