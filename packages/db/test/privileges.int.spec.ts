import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  createTestDatabase,
  expectPgError,
  inRolledBackTransaction,
  SQLSTATE,
  type TestDatabase,
} from "../src/testing/index.js";
import {
  documentedPrivileges,
  documentedTables,
  documentedViews,
} from "./docs.js";
import * as fixture from "./fixtures.js";

/**
 * Least-privilege database roles (ADR-0008). The snapshot compares what
 * each role may really do with the matrix in DATA_MODEL.md, so any drift in
 * either shows up in review. The functional checks then try the
 * operations that matter most, as those roles.
 */

const LETTERS = { S: "SELECT", I: "INSERT", U: "UPDATE", D: "DELETE" } as const;
type Letter = keyof typeof LETTERS;

/** Table-wide privileges from a matrix cell such as "S I U" or "D, plus S on ...". */
function tableWide(cell: string): Letter[] {
  if (cell === "none") return [];
  const [letters = ""] = cell.split(",");
  return letters
    .trim()
    .split(/\s+/)
    .filter((letter): letter is Letter => letter in LETTERS)
    .sort();
}

/** Column-level SELECT that the matrix describes in words. */
const EXPIRY_COLUMNS: Record<string, string[]> = {
  sessions: ["expires_at", "idle_expires_at"],
  auth_tokens: ["expires_at"],
};

describe("database roles and privileges", () => {
  let db: TestDatabase;

  beforeAll(async () => {
    db = await createTestDatabase("dsd_test_privileges");
  });

  afterAll(async () => {
    await db.drop();
  });

  async function actualTableWide(
    role: string,
    table: string,
  ): Promise<Letter[]> {
    const { rows } = await db
      .pool("dsd_migrator")
      .query<Record<Letter, boolean>>(
        `SELECT ${Object.entries(LETTERS)
          .map(
            ([letter, privilege]) =>
              `has_table_privilege($1, $2, '${privilege}') AS "${letter}"`,
          )
          .join(", ")}`,
        [role, `public.${table}`],
      );
    const row = rows[0] ?? ({} as Record<Letter, boolean>);
    return (Object.keys(LETTERS) as Letter[])
      .filter((letter) => row[letter])
      .sort();
  }

  describe("snapshot against DATA_MODEL.md", () => {
    const matrix = documentedPrivileges();

    it("lists every table", () => {
      expect([...matrix.keys()].sort()).toEqual(documentedTables().sort());
    });

    it.each([...matrix.entries()])("%s", async (table, cells) => {
      expect({
        api: await actualTableWide("dsd_api", table),
        worker: await actualTableWide("dsd_worker", table),
      }).toEqual({
        api: tableWide(cells.api),
        worker: tableWide(cells.worker),
      });
    });

    it.each([...documentedViews().entries()])(
      "view %s",
      async (view, cells) => {
        expect({
          api: await actualTableWide("dsd_api", view),
          worker: await actualTableWide("dsd_worker", view),
        }).toEqual({
          api: tableWide(cells.api),
          worker: tableWide(cells.worker),
        });
      },
    );

    it("gives the worker SELECT on the expiry columns of sessions and auth tokens, and nothing else there", async () => {
      const { rows } = await db
        .pool("dsd_migrator")
        .query<{ table_name: string; column_name: string }>(
          `SELECT table_name, column_name FROM information_schema.column_privileges
         WHERE grantee = 'dsd_worker' AND privilege_type = 'SELECT'
           AND table_name IN ('sessions', 'auth_tokens')
         ORDER BY table_name, column_name`,
        );
      const byTable: Record<string, string[]> = {};
      for (const row of rows)
        (byTable[row.table_name] ??= []).push(row.column_name);
      expect(byTable).toEqual(EXPIRY_COLUMNS);
      for (const table of Object.keys(EXPIRY_COLUMNS)) {
        expect(matrix.get(table)?.worker).toMatch(
          /plus S on the expiry columns only/,
        );
      }
    });

    it("grants no table privileges to PUBLIC", async () => {
      const { rows } = await db
        .pool("dsd_migrator")
        .query(
          "SELECT table_name, privilege_type FROM information_schema.role_table_grants WHERE grantee = 'PUBLIC' AND table_schema = 'public'",
        );
      expect(rows).toEqual([]);
    });

    it("grants neither role TRUNCATE, REFERENCES or TRIGGER on any table", async () => {
      const { rows } = await db
        .pool("dsd_migrator")
        .query(
          "SELECT grantee, table_name, privilege_type FROM information_schema.role_table_grants WHERE grantee IN ('dsd_api', 'dsd_worker') AND privilege_type IN ('TRUNCATE', 'REFERENCES', 'TRIGGER')",
        );
      expect(rows).toEqual([]);
    });

    it("lets only the API draw ticket numbers", async () => {
      const { rows } = await db
        .pool("dsd_migrator")
        .query<{ api: boolean; worker: boolean }>(
          "SELECT has_sequence_privilege('dsd_api', 'ticket_number_seq', 'USAGE') AS api, has_sequence_privilege('dsd_worker', 'ticket_number_seq', 'USAGE') AS worker",
        );
      expect(rows[0]).toEqual({ api: true, worker: false });
    });

    it("gives the service roles no special powers and no ownership", async () => {
      const { rows: roles } = await db
        .pool("dsd_migrator")
        .query(
          "SELECT rolname, rolsuper, rolcreaterole, rolcreatedb, rolbypassrls FROM pg_roles WHERE rolname IN ('dsd_api', 'dsd_worker', 'dsd_migrator') ORDER BY rolname",
        );
      for (const role of roles) {
        expect(role).toMatchObject({
          rolsuper: false,
          rolcreaterole: false,
          rolcreatedb: false,
          rolbypassrls: false,
        });
      }
      const { rows: owned } = await db
        .pool("dsd_migrator")
        .query(
          "SELECT relname FROM pg_class WHERE relnamespace = 'public'::regnamespace AND pg_get_userbyid(relowner) <> 'dsd_migrator'",
        );
      expect(owned).toEqual([]);
    });
  });

  describe("the worker can't create customer-visible messages (ADR-0006)", () => {
    it.each([
      [
        "messages",
        "INSERT INTO messages (ticket_id, author_type, author_agent_id, visibility, body) VALUES ('00000000-0000-7000-8000-000000000001', 'agent', '00000000-0000-7000-8000-000000000002', 'public', 'Sent by the AI')",
      ],
      [
        "tickets",
        "UPDATE tickets SET status = 'resolved', resolved_at = now()",
      ],
      [
        "audit_events",
        "INSERT INTO audit_events (entity_type, entity_id, action, actor_type, request_id) VALUES ('ticket', '00000000-0000-7000-8000-000000000001', 'ticket.status_changed', 'system', 'worker')",
      ],
    ])("is refused writing to %s", async (_table, statement) => {
      const error = await inRolledBackTransaction(
        db.pool("dsd_worker"),
        (client) => expectPgError(client, statement),
      );
      expect(error.code).toBe(SQLSTATE.insufficientPrivilege);
    });

    it("can store a suggestion draft, its only output", async () => {
      const ticketId = await (async () => {
        const client = await db.pool("dsd_migrator").connect();
        try {
          return (await fixture.scenario(client)).ticketId;
        } finally {
          client.release();
        }
      })();
      await inRolledBackTransaction(db.pool("dsd_worker"), async (client) => {
        await client.query(
          "INSERT INTO ai_suggestions (ticket_id, trigger_event_id, provider, model, prompt_version, retrieval_mode, status, draft_body) VALUES ($1, gen_random_uuid(), 'mock', 'mock-1', 'reply-draft/v1', 'hybrid', 'ready', 'Draft for an agent to review.')",
          [ticketId],
        );
      });
    });
  });

  describe("the worker reads only reply text customers were sent (ADR-0006)", () => {
    it("is refused every read of messages, internal notes included", async () => {
      for (const statement of [
        "SELECT body FROM messages",
        "SELECT count(*) FROM messages WHERE visibility = 'internal'",
      ]) {
        const error = await inRolledBackTransaction(
          db.pool("dsd_worker"),
          (client) => expectPgError(client, statement),
        );
        expect(error.code).toBe(SQLSTATE.insufficientPrivilege);
      }
    });

    it("sees public agent replies through the view, and never a note or a customer's message", async () => {
      const owner = await db.pool("dsd_migrator").connect();
      let ids: { reply: string; note: string; customer: string };
      try {
        // A brand of its own: the suggestion test above already used the default prefix.
        const brandId = await fixture.brand(owner, "VIEW");
        const customerId = await fixture.customer(owner);
        const agentId = await fixture.agent(owner);
        const ticketId = await fixture.ticket(owner, brandId, customerId);
        const add = async (sql: string, values: unknown[]) =>
          (await owner.query<{ id: string }>(sql, values)).rows[0]?.id ?? "";
        ids = {
          reply: await add(
            "INSERT INTO messages (ticket_id, author_type, author_agent_id, visibility, body) VALUES ($1, 'agent', $2, 'public', 'Your refund is on its way.') RETURNING id",
            [ticketId, agentId],
          ),
          note: await add(
            "INSERT INTO messages (ticket_id, author_type, author_agent_id, visibility, body) VALUES ($1, 'agent', $2, 'internal', 'CANARY internal note') RETURNING id",
            [ticketId, agentId],
          ),
          customer: await fixture.customerMessage(owner, ticketId, customerId),
        };
      } finally {
        owner.release();
      }
      const { rows } = await db
        .pool("dsd_worker")
        .query<{ id: string; body: string }>(
          "SELECT id, body FROM public_reply_bodies WHERE id = ANY($1)",
          [[ids.reply, ids.note, ids.customer]],
        );
      expect(rows).toEqual([
        { id: ids.reply, body: "Your refund is on its way." },
      ]);
      const notes = await db
        .pool("dsd_worker")
        .query("SELECT 1 FROM public_reply_bodies WHERE body LIKE '%CANARY%'");
      expect(notes.rows).toEqual([]);
    });

    it("can't change what the view shows", async () => {
      const error = await inRolledBackTransaction(
        db.pool("dsd_worker"),
        (client) =>
          expectPgError(
            client,
            "CREATE OR REPLACE VIEW public_reply_bodies AS SELECT id, ticket_id, body, created_at FROM messages",
          ),
      );
      expect(error.code).toBe(SQLSTATE.insufficientPrivilege);
    });
  });

  describe("session cleanup by the worker", () => {
    it("deletes expired sessions using only the expiry columns", async () => {
      await inRolledBackTransaction(db.pool("dsd_worker"), async (client) => {
        await client.query(
          "DELETE FROM sessions WHERE expires_at < now() OR idle_expires_at < now()",
        );
        await client.query(
          "DELETE FROM auth_tokens WHERE expires_at < now() - interval '7 days'",
        );
      });
    });

    it("can't read session tokens or who they belong to", async () => {
      const error = await inRolledBackTransaction(
        db.pool("dsd_worker"),
        (client) =>
          expectPgError(client, "SELECT token_hash, agent_id FROM sessions"),
      );
      expect(error.code).toBe(SQLSTATE.insufficientPrivilege);
    });
  });

  describe("the API", () => {
    it("can't change the schema", async () => {
      const error = await inRolledBackTransaction(
        db.pool("dsd_api"),
        (client) => expectPgError(client, "CREATE TABLE sneaky (id int)"),
      );
      expect(error.code).toBe(SQLSTATE.insufficientPrivilege);
    });

    it("can write outbox events but not read or dispatch them", async () => {
      await inRolledBackTransaction(db.pool("dsd_api"), async (client) => {
        await client.query(
          "INSERT INTO outbox_events (event_type, aggregate_type, aggregate_id, payload) VALUES ('ticket.created', 'ticket', gen_random_uuid(), '{}')",
        );
        const error = await expectPgError(
          client,
          "SELECT id FROM outbox_events",
        );
        expect(error.code).toBe(SQLSTATE.insufficientPrivilege);
      });
    });
  });
});
