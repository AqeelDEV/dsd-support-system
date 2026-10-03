import { z } from "zod";

/*
 * The answer every chat model must give (ADR-0006, section 6): a reply for
 * an agent to review, and the IDs of the sources it relies on. Providers
 * that can constrain output to a schema are given `REPLY_DRAFT_JSON_SCHEMA`;
 * every answer is checked against `replyDraftSchema` anyway, because a
 * schema-shaped answer can still be empty or cite the wrong source.
 */

export const REPLY_STATUSES = ["answered", "insufficient_context"] as const;

/** The longest draft we keep. Replies are capped at 20,000 characters; a draft needs far fewer. */
export const MAX_DRAFT_LENGTH = 6_000;

export const replyDraftSchema = z
  .object({
    status: z.enum(REPLY_STATUSES),
    reply: z.string().max(MAX_DRAFT_LENGTH),
    citations: z
      .array(z.object({ sourceId: z.string().regex(/^S\d{1,2}$/) }))
      .max(20),
  })
  .refine(
    (draft) => draft.status !== "answered" || draft.reply.trim().length > 0,
    { message: "An answered draft needs a reply", path: ["reply"] },
  );

export type ReplyDraft = z.infer<typeof replyDraftSchema>;

/**
 * The same contract as JSON Schema, written out by hand in the subset
 * Gemini, Anthropic and OpenAI all accept for constrained output: every
 * property required, no extra properties, no length or pattern keywords
 * (those are checked by `replyDraftSchema` afterwards).
 */
export const REPLY_DRAFT_JSON_SCHEMA = {
  type: "object",
  properties: {
    status: {
      type: "string",
      enum: [...REPLY_STATUSES],
      description:
        "`answered` if the sources answer the customer; `insufficient_context` if they don't",
    },
    reply: {
      type: "string",
      description:
        "The reply for the support agent to review, in plain text; empty when insufficient_context",
    },
    citations: {
      type: "array",
      description: "Every source the reply relies on",
      items: {
        type: "object",
        properties: {
          sourceId: {
            type: "string",
            description: "A source ID from the prompt, for example S1",
          },
        },
        required: ["sourceId"],
        additionalProperties: false,
      },
    },
  },
  required: ["status", "reply", "citations"],
  additionalProperties: false,
} as const;

export type ParsedDraft =
  { ok: true; draft: ReplyDraft } | { ok: false; problem: string };

/**
 * Reads a model's answer strictly: it must be one JSON value matching the
 * contract. Nothing is repaired or guessed, because an answer that doesn't
 * follow the format may not follow the instructions either.
 */
export function parseReplyDraft(text: string): ParsedDraft {
  let value: unknown;
  try {
    value = JSON.parse(text.trim());
  } catch {
    return { ok: false, problem: "not JSON" };
  }
  const parsed = replyDraftSchema.safeParse(value);
  return parsed.success
    ? { ok: true, draft: parsed.data }
    : {
        ok: false,
        problem: parsed.error.issues
          .map(
            (issue) => `${issue.path.join(".") || "answer"}: ${issue.message}`,
          )
          .join("; "),
      };
}
