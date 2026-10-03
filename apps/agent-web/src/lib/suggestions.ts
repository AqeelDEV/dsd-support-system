"use client";

import { ApiProblem, ok } from "@dsd/api-client";
import type {
  AiRejectionReason,
  AiSuggestion,
  FeedbackRating,
} from "@dsd/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "./api";

/** How often the panel asks again while a draft is being written. */
export const DRAFTING_POLL_MS = 2_000;

/** How often it looks for drafts that new messages triggered, otherwise. */
export const IDLE_POLL_MS = 30_000;

/**
 * How long the panel waits for an answer to "Generate" before saying none
 * came. Drafts normally take a few seconds; the worker retries a failing
 * provider for about half a minute before giving up.
 */
export const REQUEST_PATIENCE_MS = 90_000;

/**
 * How long after a customer writes the panel expects an automatic draft:
 * the worker waits 10 seconds for more messages, then drafts in a few.
 */
export const AUTO_DRAFT_WINDOW_MS = 2 * 60_000;

/** Why a draft was discarded, in an agent's words. */
export const REJECTION_TEXT: Record<AiRejectionReason, string> = {
  invalid_output: "the model's answer wasn't in the expected form",
  no_citations: "it didn't cite the knowledge base",
  citation_not_in_retrieved_set: "it cited an article it wasn't given",
  link_not_in_sources:
    "it contained a link that isn't in the articles it cited",
  cited_article_unpublished: "an article it cited was unpublished meanwhile",
  model_refused: "the model declined to answer",
};

export interface PanelState {
  /** A draft is being written: the latest suggestion is pending, or a request hasn't been answered yet. */
  drafting: boolean;
  /** The suggestion to show: the newest one that has finished, if any. */
  shown: AiSuggestion | undefined;
}

/**
 * What the panel shows, from the ticket's suggestions (newest first) and
 * the time of a "Generate" request still waiting for its answer. A request
 * is answered by any suggestion created at or after it, because the worker
 * may fold the request into a draft it was about to write anyway.
 */
export function panelState(
  items: readonly AiSuggestion[],
  requestedAt: string | undefined,
): PanelState {
  const latest = items[0];
  const answered =
    requestedAt === undefined ||
    items.some((item) => Date.parse(item.createdAt) >= Date.parse(requestedAt));
  return {
    drafting: !answered || latest?.status === "pending",
    shown: items.find((item) => item.status !== "pending"),
  };
}

/**
 * Whether a draft is probably on its way without anyone asking: the
 * customer wrote recently (a new ticket or a message), and no suggestion
 * has been created since. The panel then polls quickly, so the draft
 * appears within seconds.
 */
export function expectsAutomaticDraft(
  items: readonly AiSuggestion[],
  lastCustomerActivityAt: string,
  now: number,
): boolean {
  const since = Date.parse(lastCustomerActivityAt);
  return (
    now - since < AUTO_DRAFT_WINDOW_MS &&
    !items.some((item) => Date.parse(item.createdAt) >= since)
  );
}

/** Why "Generate" was refused, for the agent. */
export function requestRefusal(error: unknown): string {
  if (error instanceof ApiProblem) {
    if (error.status === 429) {
      const minutes = Math.max(
        1,
        Math.ceil((error.retryAfterSeconds ?? 60) / 60),
      );
      return `You've asked for several drafts in a short time. Try again in ${String(minutes)} minute${minutes === 1 ? "" : "s"}.`;
    }
    if (error.status === 503) {
      return "Drafts can't be requested for a moment. Try again shortly.";
    }
    return error.message;
  }
  return "The request didn't go through. Try again.";
}

const listKey = (ticketId: string) =>
  ["ticket", ticketId, "suggestions"] as const;

/**
 * A ticket's suggestions, newest first. Polled every 2 seconds while one is
 * being drafted or is expected after the customer wrote, and every 30
 * seconds otherwise.
 */
export function useSuggestions(
  ticketId: string,
  enabled: boolean,
  requestedAt: string | undefined,
  lastCustomerActivityAt: string,
) {
  return useQuery({
    queryKey: listKey(ticketId),
    queryFn: () =>
      ok(
        api.GET("/api/v1/staff/tickets/{ticketId}/ai-suggestions", {
          params: { path: { ticketId }, query: { limit: 5 } },
        }),
      ),
    enabled,
    refetchInterval: (query) => {
      const items = query.state.data?.items ?? [];
      return panelState(items, requestedAt).drafting ||
        expectsAutomaticDraft(items, lastCustomerActivityAt, Date.now())
        ? DRAFTING_POLL_MS
        : IDLE_POLL_MS;
    },
  });
}

/** Asks the worker for a fresh draft; resolves with when it was asked. */
export function useRequestSuggestion(ticketId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () =>
      ok(
        api.POST("/api/v1/staff/tickets/{ticketId}/ai-suggestions", {
          params: { path: { ticketId } },
        }),
      ),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: listKey(ticketId) });
    },
  });
}

/** Thumbs up or down, with an optional comment, on a ready suggestion. */
export function useRateSuggestion(ticketId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({
      suggestionId,
      rating,
      comment,
    }: {
      suggestionId: string;
      rating: FeedbackRating;
      comment?: string;
    }) =>
      ok(
        api.PUT("/api/v1/staff/ai-suggestions/{suggestionId}/feedback", {
          params: { path: { suggestionId } },
          body: { rating, ...(comment === undefined ? {} : { comment }) },
        }),
      ),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: listKey(ticketId) });
    },
  });
}
