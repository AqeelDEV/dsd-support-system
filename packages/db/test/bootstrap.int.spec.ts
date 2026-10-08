import { verify } from "@node-rs/argon2";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  type BootstrapSettings,
  bootstrapProduction,
} from "../src/bootstrap.js";
import { DEMO_PASSWORD, seedDatabase } from "../src/seed/index.js";
import { createTestDatabase, type TestDatabase } from "../src/testing/index.js";

const SETTINGS: BootstrapSettings = {
  supportEmail: "info@support.example",
  admin: {
    email: "First.Admin@Support.example",
    displayName: "First Admin",
    password: "a-long-enough-admin-password",
  },
};

/** Everything bootstrap could write, without generated IDs or salts. */
const CONTENT = {
  brands:
    "SELECT slug, name, ticket_prefix, support_email FROM brands ORDER BY slug",
  agents:
    "SELECT email, email_normalized, display_name, role, deactivated_at FROM agents ORDER BY email",
  memberships:
    "SELECT a.email, b.slug FROM agent_brand_memberships m JOIN agents a ON a.id = m.agent_id JOIN brands b ON b.id = m.brand_id ORDER BY a.email",
  audit:
    "SELECT entity_type, action, actor_type, after FROM audit_events ORDER BY created_at, action",
};

async function content(db: TestDatabase) {
  const pool = db.pool("dsd_migrator");
  const result: Record<string, unknown[]> = {};
  for (const [name, query] of Object.entries(CONTENT)) {
    result[name] = (await pool.query(query)).rows;
  }
  return result;
}

async function count(db: TestDatabase, table: string): Promise<number> {
  const { rows } = await db
    .pool("dsd_migrator")
    .query<{ n: string }>(`SELECT count(*) AS n FROM ${table}`);
  return Number(rows[0]?.n);
}

describe("bootstrap on an empty database", () => {
  let db: TestDatabase;

  beforeAll(async () => {
    db = await createTestDatabase("dsd_test_bootstrap");
    const result = await bootstrapProduction(db.pool("dsd_migrator"), SETTINGS);
    expect(result.bootstrapped).toBe(true);
  });

  afterAll(async () => {
    await db.drop();
  });

  it("creates the DSD brand, sending from the configured address", async () => {
    expect((await content(db)).brands).toEqual([
      {
        slug: "dsd",
        name: "DSD",
        ticket_prefix: "DSD",
        support_email: "info@support.example",
      },
    ]);
  });

  it("creates one active admin, a member of the brand", async () => {
    const { agents, memberships } = await content(db);
    expect(agents).toEqual([
      {
        email: "First.Admin@Support.example",
        email_normalized: "first.admin@support.example",
        display_name: "First Admin",
        role: "admin",
        deactivated_at: null,
      },
    ]);
    expect(memberships).toEqual([
      { email: "First.Admin@Support.example", slug: "dsd" },
    ]);
  });

  it("hashes the admin's password with argon2id at the shared cost", async () => {
    const { rows } = await db
      .pool("dsd_migrator")
      .query<{ password_hash: string }>("SELECT password_hash FROM agents");
    const hash = rows[0]?.password_hash ?? "";
    expect(hash).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
    expect(await verify(hash, SETTINGS.admin.password)).toBe(true);
    expect(hash).not.toContain(SETTINGS.admin.password);
  });

  it("records the admin's creation as a system audit event", async () => {
    const { rows } = await db.pool("dsd_migrator").query<{
      ticket_id: string | null;
      entity_type: string;
      entity_is_admin: boolean;
      action: string;
      actor_type: string;
      actor_customer_id: string | null;
      actor_agent_id: string | null;
      before: unknown;
      after: unknown;
      request_id: string;
    }>(
      `SELECT e.ticket_id, e.entity_type, e.entity_id = a.id AS entity_is_admin, e.action,
              e.actor_type, e.actor_customer_id, e.actor_agent_id, e.before, e.after, e.request_id
         FROM audit_events e CROSS JOIN agents a`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      ticket_id: null,
      entity_type: "agent",
      entity_is_admin: true,
      action: "agent.created",
      actor_type: "system",
      actor_customer_id: null,
      actor_agent_id: null,
      before: null,
      after: { role: "admin" },
    });
    expect(rows[0]?.request_id).toMatch(/^bootstrap-[0-9a-f-]{36}$/);
  });

  it("writes no outbox event, session, customer, ticket or demo account", async () => {
    expect({
      outbox: await count(db, "outbox_events"),
      sessions: await count(db, "sessions"),
      tokens: await count(db, "auth_tokens"),
      customers: await count(db, "customers"),
      tickets: await count(db, "tickets"),
      articles: await count(db, "kb_articles"),
      canned: await count(db, "canned_responses"),
    }).toEqual({
      outbox: 0,
      sessions: 0,
      tokens: 0,
      customers: 0,
      tickets: 0,
      articles: 0,
      canned: 0,
    });
    const { rows } = await db
      .pool("dsd_migrator")
      .query(
        "SELECT 1 FROM agents WHERE email_normalized LIKE '%@dsd.example'",
      );
    expect(rows).toHaveLength(0);
  });

  it("does nothing when it runs again, even with other settings", async () => {
    const before = await content(db);
    const result = await bootstrapProduction(db.pool("dsd_migrator"), {
      supportEmail: "other@support.example",
      admin: { ...SETTINGS.admin, email: "someone.else@support.example" },
    });
    expect(result).toEqual({
      bootstrapped: false,
      reason: "brand dsd already exists",
    });
    expect(await content(db)).toEqual(before);
  });

  it("stops the demo seed from loading afterwards", async () => {
    const result = await seedDatabase(db.pool("dsd_migrator"));
    expect(result).toEqual({
      seeded: false,
      reason: "the demo brand already exists",
    });
    expect(await count(db, "agents")).toBe(1);
  });
});

describe("bootstrap run twice at the same time", () => {
  let db: TestDatabase;

  beforeAll(async () => {
    db = await createTestDatabase("dsd_test_bootstrap_race");
  });

  afterAll(async () => {
    await db.drop();
  });

  it("creates the brand and the admin once", async () => {
    const results = await Promise.all([
      bootstrapProduction(db.pool("dsd_migrator"), SETTINGS),
      bootstrapProduction(db.pool("dsd_migrator"), SETTINGS),
    ]);
    expect(results.map((result) => result.bootstrapped).sort()).toEqual([
      false,
      true,
    ]);
    expect({
      brands: await count(db, "brands"),
      agents: await count(db, "agents"),
      memberships: await count(db, "agent_brand_memberships"),
      audit: await count(db, "audit_events"),
    }).toEqual({ brands: 1, agents: 1, memberships: 1, audit: 1 });
  });
});

describe("bootstrap on a database holding the demo data", () => {
  let db: TestDatabase;

  beforeAll(async () => {
    db = await createTestDatabase("dsd_test_bootstrap_demo");
    const seeded = await seedDatabase(db.pool("dsd_migrator"));
    expect(seeded.seeded).toBe(true);
  });

  afterAll(async () => {
    await db.drop();
  });

  it("refuses to go on, and changes nothing", async () => {
    const before = await content(db);
    await expect(
      bootstrapProduction(db.pool("dsd_migrator"), SETTINGS),
    ).rejects.toThrow(/holds the demo data/);
    expect(await content(db)).toEqual(before);
    const { rows } = await db
      .pool("dsd_migrator")
      .query<{ password_hash: string }>(
        "SELECT password_hash FROM agents WHERE email_normalized = 'admin@dsd.example'",
      );
    // The demo admin is still the demo admin: bootstrap never takes it over.
    expect(await verify(rows[0]?.password_hash ?? "", DEMO_PASSWORD)).toBe(
      true,
    );
  });
});
