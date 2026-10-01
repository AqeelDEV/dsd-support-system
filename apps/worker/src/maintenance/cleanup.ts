import type { Pool } from "@dsd/db";

import type { ObjectStore } from "../infrastructure/object-store.js";

/*
 * The daily clean-up (DATA_MODEL.md, "Data lifecycle"). Each step deletes
 * rows that nothing needs any more, using only what the worker's role may
 * read: the expiry columns of sessions and tokens, the dispatch time of
 * outbox rows, and the object keys of attachments.
 */

/** Sessions past their absolute or idle expiry. They already fail every lookup. */
export async function deleteExpiredSessions(pool: Pool): Promise<number> {
  const result = await pool.query(
    "DELETE FROM sessions WHERE expires_at < now() OR idle_expires_at < now()",
  );
  return result.rowCount ?? 0;
}

/** Emailed-link tokens a week past their expiry. */
export async function deleteExpiredTokens(pool: Pool): Promise<number> {
  const result = await pool.query(
    "DELETE FROM auth_tokens WHERE expires_at < now() - interval '7 days'",
  );
  return result.rowCount ?? 0;
}

/**
 * Outbox rows dispatched more than a week ago. The outbox is a transport,
 * not a history; the history is in `audit_events` (ADR-0005, section 3).
 */
export async function deleteDispatchedEvents(pool: Pool): Promise<number> {
  const result = await pool.query(
    "DELETE FROM outbox_events WHERE dispatched_at < now() - interval '7 days'",
  );
  return result.rowCount ?? 0;
}

/** Where the API stores attachments (ADR-0009, section 3). */
export const ATTACHMENT_PREFIX = "attachments/";

/** Objects younger than this are left alone: their upload may still be committing. */
export const ORPHAN_MIN_AGE_MS = 24 * 60 * 60 * 1000;

/**
 * Deletes stored files that no `attachments` row refers to (ADR-0009,
 * section 3). The API stores a file before the transaction that records
 * it commits, and deletes it if that transaction fails; if the process
 * dies in between, the file is left without a row. Such a file can't be
 * downloaded, because downloads look files up by their row, but it takes
 * space. Only objects older than `minAgeMs` are considered, so a file
 * whose row is about to commit is never touched. `prefix` narrows the
 * sweep, which tests use to stay clear of each other's files.
 */
export async function sweepOrphanedFiles(
  pool: Pool,
  store: ObjectStore,
  options: { minAgeMs?: number; prefix?: string } = {},
): Promise<number> {
  const cutoff = Date.now() - (options.minAgeMs ?? ORPHAN_MIN_AGE_MS);
  let deleted = 0;
  for await (const page of store.list(options.prefix ?? ATTACHMENT_PREFIX)) {
    const old = page
      .filter((object) => object.lastModified.getTime() <= cutoff)
      .map((object) => object.key);
    if (old.length === 0) continue;
    const { rows } = await pool.query<{ object_key: string }>(
      "SELECT object_key FROM attachments WHERE object_key = ANY($1::text[])",
      [old],
    );
    const referenced = new Set(rows.map((row) => row.object_key));
    const orphans = old.filter((key) => !referenced.has(key));
    await store.deleteMany(orphans);
    deleted += orphans.length;
  }
  return deleted;
}

export interface CleanupReport {
  sessions: number;
  tokens: number;
  outboxEvents: number;
  orphanedFiles: number;
}

/** Every clean-up step, in turn. */
export async function runCleanup(
  pool: Pool,
  store: ObjectStore,
): Promise<CleanupReport> {
  return {
    sessions: await deleteExpiredSessions(pool),
    tokens: await deleteExpiredTokens(pool),
    outboxEvents: await deleteDispatchedEvents(pool),
    orphanedFiles: await sweepOrphanedFiles(pool, store),
  };
}
