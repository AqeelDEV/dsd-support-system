import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  real,
  text,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

import { createdAt, id, timestamptz, updatedAt } from "./columns.js";
import {
  aiSuggestionKind,
  aiSuggestionStatus,
  feedbackRating,
} from "./enums.js";
import { agents } from "./identity.js";
import { kbChunks } from "./kb.js";
import { tickets } from "./tickets.js";

/**
 * One row per suggestion attempt, with full provenance (ADR-0006). This is
 * the only thing the AI pipeline writes: a draft here never reaches a
 * customer unless an agent sends it as a reply.
 */
export const aiSuggestions = pgTable(
  "ai_suggestions",
  {
    id: id(),
    ticketId: uuid("ticket_id")
      .notNull()
      .references(() => tickets.id, { onDelete: "restrict" }),
    kind: aiSuggestionKind("kind").notNull().default("reply_draft"),
    status: aiSuggestionStatus("status").notNull().default("pending"),
    /** The outbox event that caused it; retries update this row instead of adding one. */
    triggerEventId: uuid("trigger_event_id").notNull(),
    requestedByAgentId: uuid("requested_by_agent_id").references(
      () => agents.id,
      {
        onDelete: "restrict",
      },
    ),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    promptVersion: text("prompt_version").notNull(),
    /** `hybrid` or `fts_only`. */
    retrievalMode: text("retrieval_mode").notNull(),
    topVectorScore: real("top_vector_score"),
    topFtsScore: real("top_fts_score"),
    draftBody: text("draft_body"),
    /** The validated model output. */
    output: jsonb("output"),
    rejectionReason: text("rejection_reason"),
    error: text("error"),
    latencyMs: integer("latency_ms"),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    createdAt: createdAt(),
    completedAt: timestamptz("completed_at"),
  },
  (table) => [
    check(
      "ai_suggestions_ready_ck",
      sql`${table.status} <> 'ready' OR ${table.draftBody} IS NOT NULL`,
    ),
    // Target of the composite foreign key from messages: a reply can only
    // use a suggestion generated for its own ticket.
    unique("ai_suggestions_id_ticket_key").on(table.id, table.ticketId),
    // One suggestion per triggering event, so retries don't duplicate.
    unique("ai_suggestions_ticket_trigger_key").on(
      table.ticketId,
      table.triggerEventId,
    ),
    index("ai_suggestions_ticket_idx").on(
      table.ticketId,
      table.createdAt.desc().nullsFirst(),
    ),
  ],
);

/** Every chunk retrieved for a suggestion, with its scores, and whether the draft cited it. */
export const aiSuggestionSources = pgTable(
  "ai_suggestion_sources",
  {
    suggestionId: uuid("suggestion_id")
      .notNull()
      .references(() => aiSuggestions.id, { onDelete: "restrict" }),
    chunkId: uuid("chunk_id")
      .notNull()
      .references(() => kbChunks.id, { onDelete: "restrict" }),
    rank: integer("rank").notNull(),
    vectorScore: real("vector_score"),
    ftsScore: real("fts_score"),
    fusedScore: real("fused_score").notNull(),
    cited: boolean("cited").notNull().default(false),
  },
  (table) => [primaryKey({ columns: [table.suggestionId, table.chunkId] })],
);

/** One rating per agent per suggestion. */
export const aiSuggestionFeedback = pgTable(
  "ai_suggestion_feedback",
  {
    id: id(),
    suggestionId: uuid("suggestion_id")
      .notNull()
      .references(() => aiSuggestions.id, { onDelete: "restrict" }),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "restrict" }),
    rating: feedbackRating("rating").notNull(),
    comment: text("comment"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    unique("ai_suggestion_feedback_agent_key").on(
      table.suggestionId,
      table.agentId,
    ),
  ],
);
