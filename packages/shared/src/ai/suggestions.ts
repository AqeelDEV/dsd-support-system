import { z } from "zod";

import {
  aiSuggestionStatusSchema,
  feedbackRatingSchema,
} from "../domain/enums.js";
import { text } from "../http/fields.js";

/*
 * AI reply suggestions (FR-21, FR-22; ADR-0006). These shapes are for
 * staff only: there is no customer version of any of them, and the customer
 * response schemas are checked to have no field a suggestion could travel
 * in.
 */

const timestamp = z.iso.datetime();

/** How chunks were found: vectors and keywords fused, or keywords alone when no embedding model is configured. */
export const RETRIEVAL_MODES = ["hybrid", "fts_only"] as const;
export const retrievalModeSchema = z.enum(RETRIEVAL_MODES);
export type RetrievalMode = z.infer<typeof retrievalModeSchema>;

/**
 * Why a draft was thrown away instead of shown (ADR-0006, section 7). A
 * rejected draft is kept for evaluation; agents only ever see the reason.
 */
export const AI_REJECTION_REASONS = [
  "invalid_output",
  "no_citations",
  "citation_not_in_retrieved_set",
  "cited_article_unpublished",
  "model_refused",
] as const;
export const aiRejectionReasonSchema = z.enum(AI_REJECTION_REASONS);
export type AiRejectionReason = z.infer<typeof aiRejectionReasonSchema>;

/** One knowledge-base article a draft relies on, with the exact text it was given. */
export const aiCitationSchema = z.object({
  articleId: z.uuid(),
  slug: z.string(),
  title: z.string().describe("The article's title as it is now"),
  headingPath: z
    .string()
    .describe(
      "Where the cited text sits, for example `How long refunds take > When you see the money`",
    ),
  excerpt: z
    .string()
    .describe("The text the draft was based on, exactly as it read then"),
  articleVersion: z.int().describe("The article version the text came from"),
  current: z
    .boolean()
    .describe(
      "False once the article has been unpublished or published again since; the excerpt is still what the draft used",
    ),
});

export const aiSuggestionFeedbackSchema = z.object({
  rating: feedbackRatingSchema,
  comment: z.string().nullable(),
  updatedAt: timestamp,
});

const agentRefSchema = z.object({ id: z.uuid(), displayName: z.string() });

export const aiSuggestionSchema = z.object({
  id: z.uuid(),
  ticketId: z.uuid(),
  status: aiSuggestionStatusSchema.describe(
    "`pending` while it is drafted; `ready` with a draft and citations; `no_grounded_answer` when the knowledge base doesn't cover the ticket well enough; `rejected` when a draft failed the checks and was discarded; `failed` when the AI provider couldn't be reached",
  ),
  draft: z
    .string()
    .nullable()
    .describe(
      "Plain text for an agent to check, edit and send as their own reply. Only set when `ready`; show it as text, never as HTML. Nothing is sent to the customer unless an agent sends it",
    ),
  citations: z
    .array(aiCitationSchema)
    .describe("The articles the draft cites; empty unless `ready`"),
  rejectionReason: aiRejectionReasonSchema
    .nullable()
    .describe("Why the draft was discarded, when `rejected`"),
  requestedBy: agentRefSchema
    .nullable()
    .describe(
      "The agent who asked for it; null when a new ticket or a customer's message triggered it",
    ),
  provider: z.string().describe("`mock` unless a real provider is configured"),
  model: z.string(),
  promptVersion: z.string(),
  retrievalMode: retrievalModeSchema,
  createdAt: timestamp,
  completedAt: timestamp.nullable(),
  myFeedback: aiSuggestionFeedbackSchema
    .nullable()
    .describe("Your rating of it, if you gave one"),
});

/** A ticket's suggestions, newest first. The panel shows the first; a few are kept so a ready one stays visible while the next is drafted. */
export const aiSuggestionListQuerySchema = z.strictObject({
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(20)
    .default(5)
    .describe("Items per page, 1 to 20"),
  cursor: z
    .string()
    .max(512)
    .optional()
    .describe("`nextCursor` from the previous page"),
});

export const aiSuggestionRequestAcceptedSchema = z.object({
  requestedAt: timestamp.describe(
    "Suggestions created at or after this time answer the request; poll the list until one appears",
  ),
});

export const aiSuggestionFeedbackRequestSchema = z.strictObject({
  rating: feedbackRatingSchema,
  comment: text(1_000)
    .optional()
    .describe("What was good or wrong about it, up to 1,000 characters"),
});

export type AiCitation = z.infer<typeof aiCitationSchema>;
export type AiSuggestion = z.infer<typeof aiSuggestionSchema>;
export type AiSuggestionFeedback = z.infer<typeof aiSuggestionFeedbackSchema>;
export type AiSuggestionListQuery = z.infer<typeof aiSuggestionListQuerySchema>;
export type AiSuggestionRequestAccepted = z.infer<
  typeof aiSuggestionRequestAcceptedSchema
>;
export type AiSuggestionFeedbackRequest = z.infer<
  typeof aiSuggestionFeedbackRequestSchema
>;
