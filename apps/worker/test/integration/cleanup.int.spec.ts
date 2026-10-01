import { randomUUID } from "node:crypto";

import {
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { createPool, type Pool } from "@dsd/db";
import {
  asOwner,
  createSeededDatabase,
  idOf,
  type TestDatabase,
} from "@dsd/db/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Env } from "../../src/config/env.js";
import { ObjectStore } from "../../src/infrastructure/object-store.js";
import {
  deleteDispatchedEvents,
  deleteExpiredSessions,
  deleteExpiredTokens,
  sweepOrphanedFiles,
} from "../../src/maintenance/cleanup.js";
import { fixtures, testEnv } from "../support/worker.js";

/**
 * The nightly clean-up (DATA_MODEL.md, "Data lifecycle"; ADR-0009,
 * section 3), run as the worker's role, which may read only the expiry
 * columns of sessions and tokens.
 */
describe("clean-up", () => {
  let database: TestDatabase;
  let env: Env;
  let pool: Pool;
  let s3: S3Client;
  let store: ObjectStore;

  beforeAll(async () => {
    database = await createSeededDatabase("dsd_test_worker_cleanup");
    env = testEnv(database);
    pool = createPool({
      connectionString: env.DATABASE_URL,
      applicationName: "test",
      onError: () => undefined,
    });
    s3 = new S3Client({
      endpoint: env.S3_ENDPOINT,
      region: env.S3_REGION,
      forcePathStyle: true,
      credentials: {
        accessKeyId: env.S3_ACCESS_KEY_ID,
        secretAccessKey: env.S3_SECRET_ACCESS_KEY,
      },
    });
    store = new ObjectStore(env);
  });

  afterAll(async () => {
    store.close();
    s3.destroy();
    await pool.end();
    await database.drop();
  });

  const exists = async (table: string, id: string) =>
    (await asOwner(database, `SELECT 1 FROM ${table} WHERE id = $1`, [id]))
      .length === 1;

  it("deletes sessions past their absolute or idle expiry, and keeps live ones", async () => {
    const customerId = await idOf(
      database,
      "customers",
      "customer@example.com",
    );
    const session = async (expires: string, idle: string) => {
      const [row] = await asOwner<{ id: string }>(
        database,
        `INSERT INTO sessions (realm, token_hash, customer_id, created_at, expires_at, idle_expires_at)
         VALUES ('customer', $1, $2, now() - interval '40 days', now() + $3::interval, now() + $4::interval)
         RETURNING id`,
        [Buffer.from(randomUUID()), customerId, expires, idle],
      );
      return row?.id ?? "";
    };
    const expired = await session("-1 day", "-1 day");
    const idle = await session("10 days", "-1 hour");
    const live = await session("10 days", "1 day");

    expect(await deleteExpiredSessions(pool)).toBeGreaterThanOrEqual(2);
    expect(await exists("sessions", expired)).toBe(false);
    expect(await exists("sessions", idle)).toBe(false);
    expect(await exists("sessions", live)).toBe(true);
  });

  it("deletes tokens a week past their expiry, and keeps newer ones", async () => {
    const customerId = await idOf(
      database,
      "customers",
      "customer@example.com",
    );
    const token = async (expiresIn: string) => {
      const [row] = await asOwner<{ id: string }>(
        database,
        `INSERT INTO auth_tokens (purpose, token_hash, customer_id, expires_at)
         VALUES ('customer_signup', $1, $2, now() + $3::interval) RETURNING id`,
        [Buffer.from(randomUUID()), customerId, expiresIn],
      );
      return row?.id ?? "";
    };
    const old = await token("-8 days");
    const recent = await token("-1 day");
    const live = await token("1 day");

    await deleteExpiredTokens(pool);
    expect(await exists("auth_tokens", old)).toBe(false);
    expect(await exists("auth_tokens", recent)).toBe(true);
    expect(await exists("auth_tokens", live)).toBe(true);
  });

  it("deletes outbox rows dispatched more than a week ago, and keeps the rest", async () => {
    const customer = await fixtures.customer(database);
    const event = async (dispatched: string | null) => {
      const id = await fixtures.event(
        database,
        "customer.signup_requested",
        { type: "customer", id: customer.id },
        { customerId: customer.id },
      );
      if (dispatched !== null) {
        await asOwner(
          database,
          "UPDATE outbox_events SET dispatched_at = now() + $2::interval WHERE id = $1",
          [id, dispatched],
        );
      }
      return id;
    };
    const old = await event("-8 days");
    const recent = await event("-1 day");
    const waiting = await event(null);

    await deleteDispatchedEvents(pool);
    expect(await exists("outbox_events", old)).toBe(false);
    expect(await exists("outbox_events", recent)).toBe(true);
    expect(await exists("outbox_events", waiting)).toBe(true);
  });

  it("deletes stored files that no attachment refers to, once they are old enough", async () => {
    // A prefix of its own: other test files store real attachments in the
    // same bucket at the same time.
    const prefix = `attachments/sweep-test-${randomUUID()}/`;
    const put = async () => {
      const key = `${prefix}${randomUUID()}`;
      await s3.send(
        new PutObjectCommand({
          Bucket: env.S3_BUCKET,
          Key: key,
          Body: "log line\n",
          ContentType: "text/plain",
        }),
      );
      return key;
    };
    const stored = async (key: string) => {
      try {
        await s3.send(
          new HeadObjectCommand({ Bucket: env.S3_BUCKET, Key: key }),
        );
        return true;
      } catch {
        return false;
      }
    };
    const orphan = await put();
    const referenced = await put();
    const customer = await fixtures.customer(database);
    const ticket = await fixtures.ticket(database, customer.id);
    await asOwner(
      database,
      `INSERT INTO attachments (ticket_id, uploader_type, uploader_customer_id, object_key,
                                filename, content_type, size_bytes, sha256)
       VALUES ($1, 'customer', $2, $3, 'log.txt', 'text/plain; charset=utf-8', 9, $4)`,
      [ticket.id, customer.id, referenced, Buffer.alloc(32)],
    );

    // With the default age, a file stored a moment ago is never touched:
    // its row may be about to commit.
    await sweepOrphanedFiles(pool, store, { prefix });
    expect(await stored(orphan)).toBe(true);

    expect(await sweepOrphanedFiles(pool, store, { prefix, minAgeMs: 0 })).toBe(
      1,
    );
    expect(await stored(orphan)).toBe(false);
    expect(await stored(referenced)).toBe(true);
  });
});
