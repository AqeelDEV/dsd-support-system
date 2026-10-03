import {
  aiSuggestionRequestedSchema,
  messageCreatedSchema,
  type RetrievalMode,
  ticketCreatedSchema,
} from "@dsd/shared";
import type { z } from "zod";

import type { Logger } from "../../logger.js";
import type { OutboxJob } from "../../outbox/dispatcher.js";
import { InvalidEventError } from "../../queues/errors.js";
import type { ChatModel } from "../providers/types.js";
import type { SuggestionDrafter } from "./drafter.js";
import { PROMPT_VERSION } from "./prompt.js";
import type { SuggestionsRepository } from "./suggestions.repository.js";
import type { TicketContextRepository } from "./ticket-context.js";

interface SuggestionRequest {
  ticketId: string;
  requestedByAgentId: string | null;
}

function payloadOf<Schema extends z.ZodType>(
  schema: Schema,
  job: OutboxJob,
): z.output<Schema> {
  const parsed = schema.safeParse(job.payload);
  if (!parsed.success) {
    throw new InvalidEventError(
      `Invalid ${job.type} payload for ${job.eventId}`,
    );
  }
  return parsed.data;
}

/**
 * Turns an event into a stored suggestion (ADR-0006): a new ticket, a
 * customer's message, or an agent asking for one. It reads the ticket as it
 * is when the job runs, so a burst of messages debounced into one job is
 * answered as a whole. A closed ticket gets nothing: it can't take a reply.
 *
 * Its only output is the suggestion row and its sources. Nothing here can
 * write a message, and the worker's database role couldn't if it tried.
 * Logs carry IDs, outcomes and counts, never ticket text or prompts.
 */
export class SuggestionHandler {
  constructor(
    private readonly contexts: TicketContextRepository,
    private readonly suggestions: SuggestionsRepository,
    private readonly drafter: SuggestionDrafter,
    private readonly chat: ChatModel,
    private readonly retrievalMode: RetrievalMode,
    private readonly logger: Logger,
  ) {}

  async handle(job: OutboxJob): Promise<void> {
    const request = this.requestOf(job);
    if (request === null) return;
    const ticket = await this.contexts.load(request.ticketId);
    if (ticket === undefined || ticket.status === "closed") {
      this.logger.info(
        { eventId: job.eventId, ticketId: request.ticketId },
        "no suggestion for a missing or closed ticket",
      );
      return;
    }

    const row = await this.suggestions.start({
      ticketId: ticket.ticketId,
      triggerEventId: job.eventId,
      requestedByAgentId: request.requestedByAgentId,
      provider: this.chat.provider,
      model: this.chat.model,
      promptVersion: PROMPT_VERSION,
      retrievalMode: this.retrievalMode,
    });
    if (row.status !== "pending") {
      this.logger.info(
        { eventId: job.eventId, suggestionId: row.id, status: row.status },
        "suggestion already drafted",
      );
      return;
    }

    const outcome = await this.drafter.draft(ticket);
    const written = await this.suggestions.finish(row.id, outcome);
    this.logger.info(
      {
        eventId: job.eventId,
        ticketId: ticket.ticketId,
        suggestionId: row.id,
        status: outcome.status,
        rejectionReason: outcome.rejectionReason,
        retrievalMode: outcome.retrieval.mode,
        chunks: outcome.retrieval.chunks.length,
        modelCalled: outcome.modelCalled,
        latencyMs: outcome.latencyMs,
        inputTokens: outcome.usage?.inputTokens,
        outputTokens: outcome.usage?.outputTokens,
        written,
      },
      "suggestion drafted",
    );
  }

  /** After the job's last attempt: the suggestion is marked failed. */
  async failed(job: OutboxJob, reason: string): Promise<void> {
    const request = this.requestOf(job);
    if (request === null) return;
    await this.suggestions.fail(request.ticketId, job.eventId, reason);
  }

  /** The ticket an event asks a suggestion for, or null for one that asks for none. */
  private requestOf(job: OutboxJob): SuggestionRequest | null {
    switch (job.type) {
      case "ticket.created":
        return {
          ticketId: payloadOf(ticketCreatedSchema, job).ticketId,
          requestedByAgentId: null,
        };
      case "message.created": {
        const event = payloadOf(messageCreatedSchema, job);
        // Only what a customer writes needs an answer drafted.
        return event.authorType === "customer"
          ? { ticketId: event.ticketId, requestedByAgentId: null }
          : null;
      }
      case "ai.suggestion_requested": {
        const event = payloadOf(aiSuggestionRequestedSchema, job);
        return { ticketId: event.ticketId, requestedByAgentId: event.agentId };
      }
      default:
        throw new InvalidEventError(`No suggestion for ${job.type}`);
    }
  }
}
