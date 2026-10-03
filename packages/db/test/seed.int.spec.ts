import { createHash } from "node:crypto";

import { verify } from "@node-rs/argon2";
import { TICKET_PRIORITIES, TICKET_STATUSES } from "@dsd/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  DEMO_PASSWORD,
  type SeedObjectStore,
  seedDatabase,
} from "../src/seed/index.js";
import { createTestDatabase, type TestDatabase } from "../src/testing/index.js";

const ANCHOR = new Date("2026-09-30T12:00:00Z");

/** Everything a person would see, without generated IDs or password salts. */
const CONTENT = {
  agents:
    "SELECT email, display_name, role, password_hash IS NOT NULL AS has_password, deactivated_at FROM agents ORDER BY email",
  customers:
    "SELECT email, display_name, email_verified_at, password_hash IS NOT NULL AS has_password FROM customers ORDER BY email",
  tickets: `SELECT t.reference, c.email AS customer, t.subject, t.description, t.status, t.priority,
              a.email AS assignee, t.created_at, t.first_response_at, t.resolved_at, t.closed_at, t.escalated_at
            FROM tickets t JOIN customers c ON c.id = t.customer_id LEFT JOIN agents a ON a.id = t.assignee_agent_id
            ORDER BY t.reference`,
  messages: `SELECT t.reference, m.author_type, m.visibility, m.body, m.created_at
             FROM messages m JOIN tickets t ON t.id = m.ticket_id ORDER BY t.reference, m.created_at, m.body`,
  // Assignment events hold agent IDs, which differ per database; compare the
  // agents' emails instead.
  audit: `SELECT action, actor_type,
            jsonb_set_lax(before, '{assigneeAgentId}', to_jsonb((SELECT email FROM agents WHERE id::text = before->>'assigneeAgentId')), false, 'return_target') AS before,
            jsonb_set_lax(after, '{assigneeAgentId}', to_jsonb((SELECT email FROM agents WHERE id::text = after->>'assigneeAgentId')), false, 'return_target') AS after,
            created_at
          FROM audit_events ORDER BY created_at, action, request_id`,
};

async function content(db: TestDatabase) {
  const pool = db.pool("dsd_migrator");
  const result: Record<string, unknown[]> = {};
  for (const [name, query] of Object.entries(CONTENT)) {
    result[name] = (await pool.query(query)).rows;
  }
  return result;
}

describe("seed", () => {
  let db: TestDatabase;
  let twin: TestDatabase;

  beforeAll(async () => {
    [db, twin] = await Promise.all([
      createTestDatabase("dsd_test_seed"),
      createTestDatabase("dsd_test_seed_twin"),
    ]);
    const results = await Promise.all([
      seedDatabase(db.pool("dsd_migrator"), { anchor: ANCHOR }),
      seedDatabase(twin.pool("dsd_migrator"), { anchor: ANCHOR }),
    ]);
    expect(results.map((result) => result.seeded)).toEqual([true, true]);
  });

  afterAll(async () => {
    await Promise.all([db.drop(), twin.drop()]);
  });

  const count = async (table: string) => {
    const { rows } = await db
      .pool("dsd_migrator")
      .query<{ n: string }>(`SELECT count(*) AS n FROM ${table}`);
    return Number(rows[0]?.n);
  };

  it("loads one brand, the staff, the customers, the tickets, the canned responses and the knowledge base", async () => {
    expect({
      brands: await count("brands"),
      agents: await count("agents"),
      memberships: await count("agent_brand_memberships"),
      customers: await count("customers"),
      tickets: await count("tickets"),
      canned: await count("canned_responses"),
      categories: await count("kb_categories"),
      articles: await count("kb_articles"),
    }).toEqual({
      brands: 1,
      agents: 9,
      memberships: 9,
      customers: 20,
      tickets: 60,
      canned: 6,
      categories: 4,
      articles: 35,
    });
    const { rows } = await db
      .pool("dsd_migrator")
      .query<{ status: string; n: number }>(
        "SELECT status, count(*)::int AS n FROM kb_articles GROUP BY status ORDER BY status",
      );
    expect(rows).toEqual([
      { status: "draft", n: 2 },
      { status: "published", n: 33 },
    ]);
    expect(await count("messages")).toBeGreaterThan(100);
    expect(await count("audit_events")).toBeGreaterThan(
      await count("messages"),
    );
  });

  it("writes no outbox events, so the worker never emails demo users", async () => {
    expect(await count("outbox_events")).toBe(0);
    expect(await count("sessions")).toBe(0);
    expect(await count("auth_tokens")).toBe(0);
  });

  it("covers every ticket status and priority", async () => {
    const { rows } = await db
      .pool("dsd_migrator")
      .query<{ status: string; priority: string }>(
        "SELECT DISTINCT status, priority FROM tickets",
      );
    expect(new Set(rows.map((row) => row.status))).toEqual(
      new Set(TICKET_STATUSES),
    );
    expect(new Set(rows.map((row) => row.priority))).toEqual(
      new Set(TICKET_PRIORITIES),
    );
  });

  it("has a demo account for every role, each signing in with the demo password", async () => {
    const staff = await db
      .pool("dsd_migrator")
      .query<{ email: string; role: string; password_hash: string }>(
        "SELECT email, role, password_hash FROM agents WHERE email IN ('admin@dsd.example', 'supervisor@dsd.example', 'agent@dsd.example') ORDER BY role",
      );
    expect(staff.rows.map((row) => [row.email, row.role])).toEqual([
      ["agent@dsd.example", "agent"],
      ["supervisor@dsd.example", "supervisor"],
      ["admin@dsd.example", "admin"],
    ]);
    const customer = await db
      .pool("dsd_migrator")
      .query<{ password_hash: string }>(
        "SELECT password_hash FROM customers WHERE email = 'customer@example.com' AND email_verified_at IS NOT NULL",
      );
    const hashes = [...staff.rows, ...customer.rows].map(
      (row) => row.password_hash,
    );
    expect(hashes).toHaveLength(4);
    for (const hash of hashes) {
      expect(hash).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
      expect(await verify(hash, DEMO_PASSWORD)).toBe(true);
    }
  });

  it("gives the demo customer tickets to look at", async () => {
    const { rows } = await db
      .pool("dsd_migrator")
      .query(
        "SELECT t.id FROM tickets t JOIN customers c ON c.id = t.customer_id WHERE c.email = 'customer@example.com'",
      );
    expect(rows.length).toBeGreaterThanOrEqual(5);
  });

  it("produces identical content from the same anchor", async () => {
    expect(await content(twin)).toEqual(await content(db));
  });

  it("does nothing when the database already has demo data", async () => {
    const before = await content(db);
    const result = await seedDatabase(db.pool("dsd_migrator"), {
      anchor: ANCHOR,
    });
    expect(result).toEqual({
      seeded: false,
      reason: "the demo brand already exists",
    });
    expect(await content(db)).toEqual(before);
  });
});

/** An object store in memory that remembers the order of what it was asked. */
class MemoryStore implements SeedObjectStore {
  readonly calls: string[] = [];
  readonly objects = new Map<string, { bytes: Buffer; contentType: string }>();

  ensureBucket(): Promise<void> {
    this.calls.push("ensureBucket");
    return Promise.resolve();
  }

  put(key: string, bytes: Buffer, contentType: string): Promise<void> {
    this.calls.push("put");
    this.objects.set(key, { bytes, contentType });
    return Promise.resolve();
  }
}

/** What the API's content check looks at first: the file's own bytes. */
function looksLike(contentType: string, bytes: Buffer): boolean {
  switch (contentType) {
    case "image/png":
      return bytes
        .subarray(0, 8)
        .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    case "application/pdf":
      return (
        bytes.subarray(0, 5).toString("latin1") === "%PDF-" &&
        bytes.toString("latin1").trimEnd().endsWith("%%EOF")
      );
    case "text/plain; charset=utf-8":
      return (
        !bytes.includes(0) && Buffer.from(bytes.toString("utf8")).equals(bytes)
      );
    default:
      return false;
  }
}

describe("seed with an object store (attachments, ADR-0009)", () => {
  let db: TestDatabase;
  const store = new MemoryStore();
  let attachments = 0;

  beforeAll(async () => {
    db = await createTestDatabase("dsd_test_seed_files");
    const result = await seedDatabase(db.pool("dsd_migrator"), {
      anchor: ANCHOR,
      objects: store,
    });
    if (!result.seeded) throw new Error("the seed didn't run");
    attachments = result.counts.attachments;
  });

  afterAll(async () => {
    await db.drop();
  });

  it("makes sure the bucket exists before it stores anything", () => {
    expect(store.calls[0]).toBe("ensureBucket");
    expect(store.calls.filter((call) => call === "ensureBucket")).toHaveLength(
      1,
    );
    expect(store.calls.slice(1).every((call) => call === "put")).toBe(true);
  });

  it("writes a row for every stored file, and stores nothing without a row", async () => {
    const { rows } = await db.pool("dsd_migrator").query<{
      object_key: string;
      content_type: string;
      size_bytes: number;
      sha256: Buffer;
    }>("SELECT object_key, content_type, size_bytes, sha256 FROM attachments ORDER BY object_key");
    expect(attachments).toBeGreaterThanOrEqual(8);
    expect(rows).toHaveLength(attachments);
    expect([...store.objects.keys()].sort()).toEqual(
      rows.map((row) => row.object_key),
    );
    for (const row of rows) {
      const object = store.objects.get(row.object_key);
      expect(row.object_key).toMatch(/^attachments\/[0-9a-f-]{36}$/);
      expect(object?.contentType).toBe(row.content_type);
      expect(object?.bytes.length).toBe(row.size_bytes);
      expect(
        createHash("sha256")
          .update(object?.bytes ?? Buffer.alloc(0))
          .digest(),
      ).toEqual(row.sha256);
      expect(
        looksLike(row.content_type, object?.bytes ?? Buffer.alloc(0)),
      ).toBe(true);
    }
  });

  it("attaches files to the request or to the customer's own follow-up, with an audit event each", async () => {
    const { rows } = await db.pool("dsd_migrator").query<{
      on_message: boolean;
      by_ticket_customer: boolean;
      audited: boolean;
    }>(
      `SELECT a.message_id IS NOT NULL AS on_message,
              a.uploader_customer_id = t.customer_id
                AND (m.id IS NULL OR m.author_customer_id = t.customer_id) AS by_ticket_customer,
              EXISTS (SELECT 1 FROM audit_events e
                       WHERE e.entity_id = a.id AND e.action = 'attachment.created'
                         AND e.actor_customer_id = t.customer_id) AS audited
         FROM attachments a
         JOIN tickets t ON t.id = a.ticket_id
         LEFT JOIN messages m ON m.id = a.message_id`,
    );
    expect(rows.every((row) => row.by_ticket_customer && row.audited)).toBe(
      true,
    );
    expect(rows.some((row) => row.on_message)).toBe(true);
    expect(rows.some((row) => !row.on_message)).toBe(true);
  });

  it("leaves everything else exactly as a seed without files", async () => {
    const plain = await createTestDatabase("dsd_test_seed_files_plain");
    try {
      await seedDatabase(plain.pool("dsd_migrator"), { anchor: ANCHOR });
      const { rows } = await plain
        .pool("dsd_migrator")
        .query<{ n: string }>("SELECT count(*) AS n FROM attachments");
      expect(Number(rows[0]?.n)).toBe(0);
      const withFiles = await content(db);
      const without = await content(plain);
      expect(withFiles.tickets).toEqual(without.tickets);
      expect(withFiles.messages).toEqual(without.messages);
    } finally {
      await plain.drop();
    }
  });
});
