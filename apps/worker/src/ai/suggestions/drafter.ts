import type { AiRejectionReason } from "@dsd/shared";

import type {
  ChatModel,
  GenerateResult,
  TokenUsage,
} from "../providers/types.js";
import { isGrounded, type Thresholds } from "../retrieval/confidence.js";
import { retrievalQuery } from "../retrieval/query.js";
import type { Retrieval, Retriever } from "../retrieval/retriever.js";
import { buildPrompt } from "./prompt.js";
import { parseReplyDraft, REPLY_DRAFT_JSON_SCHEMA } from "./reply-draft.js";
import type { TicketContext } from "./ticket-context.js";
import { validateDraft } from "./validate.js";

export interface DraftOutcome {
  status: "ready" | "no_grounded_answer" | "rejected";
  retrieval: Retrieval;
  /** The retrieved chunks the draft cites. */
  citedChunkIds: string[];
  /** The reply for the agent; only when `ready`. */
  draft: string | null;
  /** The validated answer, or the raw text of one that failed to parse. */
  output: unknown;
  rejectionReason: AiRejectionReason | null;
  /** The model that answered, or the configured one if none was asked. */
  model: string;
  usage: TokenUsage | null;
  /** How long the model took; null when it wasn't called. */
  latencyMs: number | null;
  modelCalled: boolean;
}

/** The longest raw answer kept for a rejected draft. */
const MAX_RAW_OUTPUT = 4_000;

/**
 * Drafts one suggestion (ADR-0006, sections 4 to 7): retrieve, check the
 * confidence gate, prompt the model, validate its answer and its
 * citations. It reads the knowledge base and calls the model, and writes
 * nothing: persistence is the caller's, which keeps this usable by the
 * evaluation script against any database.
 *
 * A provider failure (an outage, a timeout) throws, so the job is retried.
 * A refusal, a bad answer or an ungrounded one is an outcome, not an
 * error: retrying it would only cost money.
 */
export class SuggestionDrafter {
  constructor(
    private readonly retriever: Retriever,
    private readonly chat: ChatModel,
    private readonly thresholds: Thresholds,
    private readonly timeoutMs: number,
    private readonly stillPublished: (
      chunkIds: readonly string[],
    ) => Promise<ReadonlySet<string>>,
  ) {}

  async draft(ticket: TicketContext): Promise<DraftOutcome> {
    const retrieval = await this.retriever.retrieve(
      ticket.brandId,
      retrievalQuery({
        subject: ticket.subject,
        description: ticket.description,
        customerMessages: ticket.conversation
          .filter((message) => message.from === "customer")
          .map((message) => message.body),
      }),
    );
    const base = {
      retrieval,
      citedChunkIds: [],
      draft: null,
      output: null,
      rejectionReason: null,
      model: this.chat.model,
      usage: null,
      latencyMs: null,
      modelCalled: false,
    };
    if (
      retrieval.chunks.length === 0 ||
      !isGrounded(retrieval, this.thresholds)
    ) {
      return { ...base, status: "no_grounded_answer" };
    }

    const prompt = buildPrompt(ticket, retrieval.chunks);
    const started = performance.now();
    const result = await this.generate({
      system: prompt.system,
      user: prompt.user,
      schema: REPLY_DRAFT_JSON_SCHEMA,
      sources: prompt.sources,
    });
    const called = {
      ...base,
      model: result.model,
      usage: result.usage,
      latencyMs: Math.round(performance.now() - started),
      modelCalled: true,
    };
    if (result.kind === "refused") {
      return {
        ...called,
        status: "rejected",
        rejectionReason: "model_refused",
      };
    }

    const parsed = parseReplyDraft(result.text);
    const output = parsed.ok
      ? parsed.draft
      : { raw: result.text.slice(0, MAX_RAW_OUTPUT), problem: parsed.problem };
    const validation = validateDraft(
      parsed,
      new Set(prompt.sources.map((source) => source.id)),
    );
    if (validation.status !== "ready") {
      return {
        ...called,
        output,
        status: validation.status,
        rejectionReason:
          validation.status === "rejected" ? validation.reason : null,
      };
    }

    const chunkOf = new Map(
      prompt.sources.map((source, index) => [
        source.id,
        retrieval.chunks[index]?.chunkId ?? "",
      ]),
    );
    const citedChunkIds = validation.citedSourceIds.map(
      (id) => chunkOf.get(id) ?? "",
    );
    // The article may have been unpublished while the model was writing.
    const published = await this.stillPublished(citedChunkIds);
    if (citedChunkIds.some((id) => !published.has(id))) {
      return {
        ...called,
        output,
        citedChunkIds,
        status: "rejected",
        rejectionReason: "cited_article_unpublished",
      };
    }
    return {
      ...called,
      output,
      citedChunkIds,
      status: "ready",
      draft: validation.reply,
    };
  }

  /** One attempt, abandoned after the timeout even if the provider ignores the signal. */
  private async generate(
    request: Omit<Parameters<ChatModel["generate"]>[0], "signal">,
  ): Promise<GenerateResult> {
    const controller = new AbortController();
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        const error = new Error(
          `The ${this.chat.provider} model didn't answer within ${String(this.timeoutMs)} ms`,
        );
        controller.abort(error);
        reject(error);
      }, this.timeoutMs);
    });
    try {
      return await Promise.race([
        this.chat.generate({ ...request, signal: controller.signal }),
        timeout,
      ]);
    } finally {
      clearTimeout(timer);
    }
  }
}
