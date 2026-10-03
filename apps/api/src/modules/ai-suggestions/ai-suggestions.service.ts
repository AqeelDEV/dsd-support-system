import { Inject, Injectable } from "@nestjs/common";
import {
  type AiCitation,
  type AiSuggestion,
  type AiSuggestionFeedback,
  type AiSuggestionFeedbackRequest,
  type AiSuggestionListQuery,
  type AiSuggestionRequestAccepted,
  aiRejectionReasonSchema,
  PROBLEM_TYPES,
  retrievalModeSchema,
} from "@dsd/shared";
import { z } from "zod";

import type { StaffPrincipal } from "../../auth/principal.js";
import { RateLimitEnforcer } from "../../auth/rate-limit/enforcer.js";
import { RATE_LIMITS } from "../../auth/rate-limit/policies.js";
import {
  decodeCursor,
  encodeCursor,
  exactTimestamp,
  pageFrom,
} from "../../common/cursor.js";
import { ProblemException } from "../../common/problem-details.js";
import type { Executor } from "../../infrastructure/database.js";
import { DB } from "../../infrastructure/tokens.js";
import { OutboxRepository } from "../outbox/outbox.repository.js";
import { assertNotClosed } from "../tickets/domain/ticket-status.js";
import { ticketNotFound } from "../tickets/ticket-queries.service.js";
import { TicketsRepository } from "../tickets/tickets.repository.js";
import { iso, isoOrNull } from "../tickets/views.js";
import {
  AiSuggestionsRepository,
  type CitationRow,
  type SuggestionRow,
} from "./ai-suggestions.repository.js";

const SORT = "newest";
const cursorKeys = z.tuple([exactTimestamp]);

const suggestionNotFound = () =>
  new ProblemException(404, PROBLEM_TYPES.blank, "No such suggestion.");

/**
 * What staff see of a suggestion. The draft and its citations appear only
 * when it is `ready`; a rejected draft shows its reason and never its text,
 * and a failure shows no provider error, which could say anything.
 */
function toSuggestion(
  row: SuggestionRow,
  citations: CitationRow[],
): AiSuggestion {
  const ready = row.status === "ready";
  const rejection = aiRejectionReasonSchema.safeParse(row.rejectionReason);
  return {
    id: row.id,
    ticketId: row.ticketId,
    status: row.status,
    draft: ready ? row.draftBody : null,
    citations: ready ? citations.map(toCitation) : [],
    rejectionReason:
      row.status === "rejected" && rejection.success ? rejection.data : null,
    requestedBy:
      row.requestedById === null
        ? null
        : { id: row.requestedById, displayName: row.requestedByName ?? "" },
    provider: row.provider,
    model: row.model,
    promptVersion: row.promptVersion,
    retrievalMode: retrievalModeSchema.parse(row.retrievalMode),
    createdAt: iso(row.createdAt),
    completedAt: isoOrNull(row.completedAt),
    myFeedback:
      row.feedbackRating === null || row.feedbackUpdatedAt === null
        ? null
        : {
            rating: row.feedbackRating,
            comment: row.feedbackComment,
            updatedAt: iso(row.feedbackUpdatedAt),
          },
  };
}

function toCitation(row: CitationRow): AiCitation {
  return {
    articleId: row.articleId,
    slug: row.slug,
    title: row.title,
    headingPath: row.headingPath,
    excerpt: row.excerpt,
    articleVersion: row.articleVersion,
    current: row.current,
  };
}

/**
 * The agent's side of AI suggestions (FR-21, FR-22; ADR-0006, section 11):
 * reading a ticket's drafts, asking for a new one, and rating one. Nothing
 * here writes a message; a draft reaches a customer only as an agent's own
 * reply, through the reply endpoint.
 */
@Injectable()
export class AiSuggestionsService {
  constructor(
    @Inject(DB) private readonly db: Executor,
    private readonly suggestions: AiSuggestionsRepository,
    private readonly tickets: TicketsRepository,
    private readonly outbox: OutboxRepository,
    private readonly limits: RateLimitEnforcer,
  ) {}

  /** A ticket's suggestions, newest first: the panel shows the first. */
  async list(
    principal: StaffPrincipal,
    ticketId: string,
    query: AiSuggestionListQuery,
  ): Promise<{ items: AiSuggestion[]; nextCursor: string | null }> {
    const after =
      query.cursor === undefined
        ? undefined
        : decodeCursor(query.cursor, SORT, cursorKeys);
    const rows = await this.db.transaction(
      async (tx) => {
        if (
          !(await this.tickets.visibleToStaff(tx, principal.agent.id, ticketId))
        ) {
          throw ticketNotFound();
        }
        const page = await this.suggestions.page(
          tx,
          principal.agent.id,
          ticketId,
          {
            limit: query.limit,
            after:
              after === undefined
                ? undefined
                : { at: after.keys[0], id: after.id },
          },
        );
        const shown = page.slice(0, query.limit);
        const citations = await this.suggestions.citations(
          tx,
          shown.filter((row) => row.status === "ready").map((row) => row.id),
        );
        return { page, citations };
      },
      { isolationLevel: "repeatable read", accessMode: "read only" },
    );
    const bySuggestion = Map.groupBy(rows.citations, (row) => row.suggestionId);
    return pageFrom(
      rows.page,
      query.limit,
      (row) => toSuggestion(row, bySuggestion.get(row.id) ?? []),
      (row) => encodeCursor(SORT, { keys: [row.cursorAt], id: row.id }),
    );
  }

  /**
   * Asks the worker for a fresh draft. It goes through the outbox like any
   * other event, so it is never lost and never blocks; the answer is a new
   * suggestion the panel picks up by polling. Limited per ticket and per
   * agent, because each draft can cost money with a real provider, and
   * refused while Redis is down for the same reason.
   */
  async request(
    principal: StaffPrincipal,
    ticketId: string,
  ): Promise<AiSuggestionRequestAccepted> {
    const requestedAt = await this.db.transaction(async (tx) => {
      const ticket = await this.tickets.lockForStaff(
        tx,
        principal.agent.id,
        ticketId,
      );
      if (ticket === undefined) throw ticketNotFound();
      assertNotClosed(ticket.status);
      // Counted only once the request is otherwise allowed, so a mistake
      // doesn't use up the allowance; a refusal rolls this back.
      await this.limits.enforce(RATE_LIMITS.aiSuggestionRequest, {
        ticket: ticketId,
        agent: principal.agent.id,
      });
      await this.outbox.add(tx, {
        type: "ai.suggestion_requested",
        aggregateType: "ticket",
        aggregateId: ticketId,
        payload: { ticketId, agentId: principal.agent.id },
      });
      return this.suggestions.now(tx);
    });
    return { requestedAt: iso(requestedAt) };
  }

  /** The agent's thumbs up or down on a ready suggestion, replacing any earlier one. */
  async rate(
    principal: StaffPrincipal,
    suggestionId: string,
    feedback: AiSuggestionFeedbackRequest,
  ): Promise<AiSuggestionFeedback> {
    const target = await this.suggestions.target(
      this.db,
      principal.agent.id,
      suggestionId,
    );
    if (target === undefined) throw suggestionNotFound();
    if (target.status !== "ready") {
      throw new ProblemException(
        409,
        PROBLEM_TYPES.blank,
        "Only a ready suggestion can be rated.",
      );
    }
    const saved = await this.suggestions.saveFeedback(this.db, {
      suggestionId,
      agentId: principal.agent.id,
      rating: feedback.rating,
      comment: feedback.comment ?? null,
    });
    return {
      rating: saved.rating,
      comment: saved.comment,
      updatedAt: iso(saved.updatedAt),
    };
  }
}
