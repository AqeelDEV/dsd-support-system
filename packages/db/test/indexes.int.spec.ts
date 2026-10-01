import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { seedDatabase } from "../src/seed/index.js";
import {
  createTestDatabase,
  inRolledBackTransaction,
  type TestDatabase,
} from "../src/testing/index.js";

/**
 * Each index in DATA_MODEL.md exists for a query. On the small seeded
 * dataset PostgreSQL would rightly prefer sequential scans, so they are
 * switched off here: the question is whether the index can serve
 * the query at all (same columns, order and null ordering, a matching
 * partial condition). Phase 10 measures real timings on 5,000+ tickets.
 */

interface PlanNode {
  "Node Type": string;
  "Index Name"?: string;
  Plans?: PlanNode[];
}

function nodeTypesIn(node: PlanNode): string[] {
  return [node["Node Type"], ...(node.Plans ?? []).flatMap(nodeTypesIn)];
}

function indexesIn(node: PlanNode): string[] {
  return [
    ...(node["Index Name"] === undefined ? [] : [node["Index Name"]]),
    ...(node.Plans ?? []).flatMap(indexesIn),
  ];
}

const vector = `[${Array.from({ length: 1024 }, (_, index) => (index % 7) / 7).join(",")}]`;

describe("indexes serve the queries they were designed for", () => {
  let db: TestDatabase;
  let ids: {
    brandId: string;
    customerId: string;
    agentId: string;
    ticketId: string;
  };

  beforeAll(async () => {
    db = await createTestDatabase("dsd_test_indexes");
    await seedDatabase(db.pool("dsd_migrator"), {
      anchor: new Date("2026-09-30T12:00:00Z"),
    });
    await db.pool("dsd_migrator").query("ANALYZE");
    const { rows } = await db.pool("dsd_migrator").query<typeof ids>(
      `SELECT t.brand_id AS "brandId", t.customer_id AS "customerId", t.assignee_agent_id AS "agentId", t.id AS "ticketId"
       FROM tickets t WHERE t.assignee_agent_id IS NOT NULL ORDER BY t.reference LIMIT 1`,
    );
    const [first] = rows;
    if (first === undefined)
      throw new Error("the seed has no assigned tickets");
    ids = first;
  });

  afterAll(async () => {
    await db.drop();
  });

  const cases: [string, string, string, () => unknown[]][] = [
    [
      "tickets_queue_idx",
      "the queue filtered by status, sorted by priority then age (FR-7)",
      "SELECT id FROM tickets WHERE brand_id = $1 AND status = 'open' ORDER BY priority DESC, created_at LIMIT 25",
      () => [ids.brandId],
    ],
    [
      "tickets_brand_created_idx",
      "the queue by age across statuses",
      "SELECT id FROM tickets WHERE brand_id = $1 ORDER BY created_at LIMIT 25",
      () => [ids.brandId],
    ],
    [
      "tickets_assignee_idx",
      "an agent's open tickets",
      "SELECT id FROM tickets WHERE assignee_agent_id = $1 AND status IN ('open', 'pending_customer')",
      () => [ids.agentId],
    ],
    [
      "tickets_customer_idx",
      "a customer's tickets, newest first (FR-3, FR-8)",
      "SELECT id FROM tickets WHERE customer_id = $1 ORDER BY created_at DESC LIMIT 25",
      () => [ids.customerId],
    ],
    [
      "tickets_escalated_idx",
      "the escalated tickets filter",
      "SELECT id FROM tickets WHERE brand_id = $1 AND escalated_at IS NOT NULL ORDER BY escalated_at",
      () => [ids.brandId],
    ],
    [
      "tickets_resolved_idx",
      "resolution times by resolution date (FR-13)",
      "SELECT count(*) FROM tickets WHERE brand_id = $1 AND resolved_at >= $2 AND resolved_at < $3",
      () => [ids.brandId, "2026-09-01T00:00:00Z", "2026-10-01T00:00:00Z"],
    ],
    [
      "messages_thread_idx",
      "a ticket's thread in order",
      "SELECT id FROM messages WHERE ticket_id = $1 ORDER BY created_at, id",
      () => [ids.ticketId],
    ],
    [
      "audit_events_ticket_idx",
      "a ticket's history",
      "SELECT id FROM audit_events WHERE ticket_id = $1 ORDER BY created_at",
      () => [ids.ticketId],
    ],
    [
      "outbox_events_pending_idx",
      "the dispatcher's next batch",
      "SELECT id FROM outbox_events WHERE dispatched_at IS NULL ORDER BY id LIMIT 100 FOR UPDATE SKIP LOCKED",
      () => [],
    ],
    [
      "kb_articles_search_idx",
      "knowledge-base keyword search (FR-4)",
      "SELECT id FROM kb_articles WHERE search_vector @@ websearch_to_tsquery('english', $1)",
      () => ["refund card"],
    ],
    [
      "kb_articles_browse_idx",
      "browsing published articles, newest first, as the help centre pages them (FR-4); ties on the time are put in ID order incrementally",
      "SELECT id FROM kb_articles WHERE brand_id = $1 AND status = 'published' ORDER BY published_at DESC, id DESC LIMIT 25",
      () => [ids.brandId],
    ],
    [
      "kb_chunks_search_idx",
      "keyword retrieval for AI suggestions",
      "SELECT id FROM kb_chunks WHERE search_vector @@ to_tsquery('english', $1)",
      () => ["refund | card"],
    ],
    [
      "kb_chunks_embedding_idx",
      "vector retrieval for AI suggestions",
      "SELECT id FROM kb_chunks ORDER BY embedding <=> $1::vector LIMIT 20",
      () => [vector],
    ],
    [
      "sessions_token_hash_key",
      "finding a session by its token hash on every request",
      "SELECT id FROM sessions WHERE token_hash = $1",
      () => [Buffer.from("token")],
    ],
  ];

  it.each(cases)("%s serves %s", async (index, _purpose, query, values) => {
    const plan = await inRolledBackTransaction(
      db.pool("dsd_migrator"),
      async (client) => {
        await client.query("SET LOCAL enable_seqscan = off");
        if (query.includes("ORDER BY")) {
          // Bitmap scans read an index but lose its order, so for ordered
          // queries they are off too: a Sort in the plan then means the
          // index can't supply the order. (GIN indexes are only read through
          // bitmap scans, which is why this isn't switched off everywhere.)
          await client.query("SET LOCAL enable_bitmapscan = off");
        }
        const { rows } = await client.query<{
          "QUERY PLAN": [{ Plan: PlanNode }];
        }>(`EXPLAIN (FORMAT JSON) ${query}`, values());
        const [explained] = rows;
        if (explained === undefined)
          throw new Error("EXPLAIN returned no plan");
        return explained["QUERY PLAN"][0].Plan;
      },
    );
    expect(indexesIn(plan)).toContain(index);
    // A query that asks for an order gets it from the index, not a sort.
    if (query.includes("ORDER BY")) {
      expect(nodeTypesIn(plan)).not.toContain("Sort");
    }
  });
});
