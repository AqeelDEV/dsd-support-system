import { createHash, randomUUID } from "node:crypto";
import net from "node:net";
import { Writable } from "node:stream";

import { asOwner, type TestDatabase } from "@dsd/db/testing";

import { type Env, parseEnv } from "../../src/config/env.js";
import { createContainer, type Container } from "../../src/container.js";
import { createWorker, type Worker } from "../../src/lifecycle.js";
import { createLogger, type Logger } from "../../src/logger.js";

/** The development services from compose.yaml, as CI starts them. */
export const MAILPIT_URL =
  process.env.TEST_MAILPIT_URL ?? "http://127.0.0.1:8025";

/**
 * A worker environment for one test file: its own database (as the
 * worker's role), its own queue prefix in the shared Redis, Mailpit for
 * SMTP and the compose object store.
 */
export function testEnv(
  database: TestDatabase,
  overrides: Record<string, string> = {},
): Env {
  return parseEnv({
    NODE_ENV: "test",
    LOG_LEVEL: "info",
    DATABASE_URL: database.url("dsd_worker"),
    REDIS_URL:
      process.env.TEST_REDIS_URL ??
      `redis://127.0.0.1:${process.env.REDIS_PORT ?? "16379"}`,
    QUEUE_PREFIX: `test-${database.name}-${randomUUID()}`,
    OUTBOX_POLL_INTERVAL_MS: "50",
    STARTUP_TIMEOUT_SECONDS: "10",
    SMTP_HOST: process.env.TEST_SMTP_HOST ?? "127.0.0.1",
    SMTP_PORT: process.env.TEST_SMTP_PORT ?? "1025",
    CUSTOMER_APP_URL: "http://customer.test",
    AGENT_APP_URL: "http://agent.test",
    S3_ENDPOINT:
      process.env.TEST_S3_ENDPOINT ??
      `http://127.0.0.1:${process.env.S3_PORT ?? "18333"}`,
    S3_ACCESS_KEY_ID: process.env.S3_ACCESS_KEY_ID ?? "dsd-dev-access-key",
    S3_SECRET_ACCESS_KEY:
      process.env.S3_SECRET_ACCESS_KEY ?? "dsd-dev-secret-key",
    ...overrides,
  });
}

/** A logger whose output a test can read. */
export function capturedLogger(): { logger: Logger; text: () => string } {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      lines.push(chunk.toString("utf8"));
      callback();
    },
  });
  return {
    logger: createLogger({ LOG_LEVEL: "info" }, stream),
    text: () => lines.join(""),
  };
}

/** A whole worker, started, with retries in milliseconds. */
export async function startTestWorker(
  env: Env,
  options: { firstRetryDelayMs?: number } = {},
): Promise<{ worker: Worker; container: Container; logs: () => string }> {
  const { logger, text } = capturedLogger();
  const container = createContainer(env, logger);
  const worker = createWorker(env, container, logger, {
    firstRetryDelayMs: options.firstRetryDelayMs ?? 20,
    schedule: false,
  });
  await worker.start();
  return { worker, container, logs: text };
}

/** A port nothing listens on. */
export async function closedPort(): Promise<number> {
  const server = net.createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as net.AddressInfo;
  await new Promise<void>((resolve) => {
    server.close(() => {
      resolve();
    });
  });
  return port;
}

/** Polls `check` until it returns something other than undefined, or fails after `timeoutMs`. */
export async function eventually<T>(
  check: () => Promise<T | undefined>,
  timeoutMs = 10_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await check();
    if (value !== undefined) return value;
    if (Date.now() > deadline) throw new Error("timed out waiting");
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

export interface Email {
  subject: string;
  to: string[];
  from: string;
  text: string;
  html: string;
}

interface MailpitSummary {
  ID: string;
}

/** Every email Mailpit holds for `address`, read through its API. */
export async function emailsTo(address: string): Promise<Email[]> {
  const search = await fetch(
    `${MAILPIT_URL}/api/v1/search?query=${encodeURIComponent(`to:"${address}"`)}`,
  );
  const { messages } = (await search.json()) as { messages: MailpitSummary[] };
  return Promise.all(
    messages.map(async ({ ID }) => {
      const response = await fetch(`${MAILPIT_URL}/api/v1/message/${ID}`);
      const message = (await response.json()) as {
        Subject: string;
        To: { Address: string }[];
        From: { Address: string };
        Text: string;
        HTML: string;
      };
      return {
        subject: message.Subject,
        to: message.To.map((to) => to.Address),
        from: message.From.Address,
        text: message.Text,
        html: message.HTML,
      };
    }),
  );
}

/** Whether any email in Mailpit contains `text`. */
export async function anyEmailContains(text: string): Promise<boolean> {
  const search = await fetch(
    `${MAILPIT_URL}/api/v1/search?query=${encodeURIComponent(`"${text}"`)}`,
  );
  const { messages } = (await search.json()) as { messages: MailpitSummary[] };
  return messages.length > 0;
}

/** The token in an emailed link, after `#token=`. */
export function tokenIn(email: Email | undefined): string {
  const token = /#token=([A-Za-z0-9_-]{43})/.exec(email?.text ?? "")?.[1];
  if (token === undefined) throw new Error("no token in the email");
  return token;
}

/** The stored row for an emailed link's token, found by its hash as the API would. */
export async function storedToken(database: TestDatabase, token: string) {
  const [row] = await asOwner<{
    purpose: string;
    customer_id: string | null;
    agent_id: string | null;
    ticket_id: string | null;
    minutes: number;
  }>(
    database,
    `SELECT purpose, customer_id, agent_id, ticket_id,
            round(extract(epoch FROM expires_at - now()) / 60)::int AS minutes
       FROM auth_tokens WHERE token_hash = $1`,
    [createHash("sha256").update(token).digest()],
  );
  return row;
}

/** Fixtures written as the schema owner, with unique emails so Mailpit searches find only this run's mail. */
export const fixtures = {
  async customer(
    database: TestDatabase,
    options: { hasAccount?: boolean } = {},
  ): Promise<{ id: string; email: string }> {
    const email = `customer-${randomUUID()}@example.com`;
    const [row] = await asOwner<{ id: string }>(
      database,
      `INSERT INTO customers (email, email_normalized, display_name, password_hash, email_verified_at)
       VALUES ($1, $1, 'Test Customer',
               CASE WHEN $2 THEN 'not-a-real-hash' END, CASE WHEN $2 THEN now() END)
       RETURNING id`,
      [email, options.hasAccount ?? false],
    );
    return { id: row?.id ?? "", email };
  },

  async agent(
    database: TestDatabase,
    options: { hasPassword?: boolean; active?: boolean } = {},
  ): Promise<{ id: string; email: string }> {
    const email = `agent-${randomUUID()}@dsd.example`;
    const [row] = await asOwner<{ id: string }>(
      database,
      `INSERT INTO agents (email, email_normalized, display_name, role, password_hash, deactivated_at)
       VALUES ($1, $1, 'Sam Agent', 'agent', CASE WHEN $2 THEN 'not-a-real-hash' END,
               CASE WHEN $3 THEN NULL ELSE now() END)
       RETURNING id`,
      [email, options.hasPassword ?? true, options.active ?? true],
    );
    await asOwner(
      database,
      "INSERT INTO agent_brand_memberships (agent_id, brand_id) SELECT $1, id FROM brands WHERE slug = 'dsd'",
      [row?.id],
    );
    return { id: row?.id ?? "", email };
  },

  async ticket(
    database: TestDatabase,
    customerId: string,
  ): Promise<{ id: string; reference: string }> {
    const [row] = await asOwner<{ id: string; reference: string }>(
      database,
      `INSERT INTO tickets (brand_id, customer_id, channel, subject, description)
       SELECT id, $1, 'web', 'Hub keeps going offline', 'It drops every evening.'
         FROM brands WHERE slug = 'dsd'
       RETURNING id, reference`,
      [customerId],
    );
    return { id: row?.id ?? "", reference: row?.reference ?? "" };
  },

  async message(
    database: TestDatabase,
    message: {
      ticketId: string;
      body: string;
      author: { agentId: string } | { customerId: string };
      visibility?: "public" | "internal";
    },
  ): Promise<string> {
    const byAgent = "agentId" in message.author;
    const [row] = await asOwner<{ id: string }>(
      database,
      `INSERT INTO messages (ticket_id, author_type, author_agent_id, author_customer_id, visibility, body)
       VALUES ($1, $2::participant_type, $3, $4, $5::message_visibility, $6)
       RETURNING id`,
      [
        message.ticketId,
        byAgent ? "agent" : "customer",
        "agentId" in message.author ? message.author.agentId : null,
        "customerId" in message.author ? message.author.customerId : null,
        message.visibility ?? "public",
        message.body,
      ],
    );
    return row?.id ?? "";
  },

  /** An outbox event, as the API writes it in the transaction of its change. */
  async event(
    database: TestDatabase,
    type: string,
    aggregate: { type: string; id: string },
    payload: Record<string, unknown>,
  ): Promise<string> {
    const [row] = await asOwner<{ id: string }>(
      database,
      `INSERT INTO outbox_events (event_type, aggregate_type, aggregate_id, payload)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [type, aggregate.type, aggregate.id, JSON.stringify(payload)],
    );
    return row?.id ?? "";
  },
};
