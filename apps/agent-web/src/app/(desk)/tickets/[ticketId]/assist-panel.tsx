"use client";

import type { AiCitation, AiSuggestion, StaffTicket } from "@dsd/shared";
import { Badge, Button, cn, Skeleton, Spinner, Textarea, toast } from "@dsd/ui";
import {
  CornerDownLeft,
  ExternalLink,
  RefreshCw,
  Sparkles,
  ThumbsDown,
  ThumbsUp,
} from "lucide-react";
import { type ReactNode, useEffect, useId, useState } from "react";

import { SuggestionDraft } from "@/components/suggestion-draft";
import { useCan } from "@/lib/session";
import {
  panelState,
  REJECTION_TEXT,
  REQUEST_PATIENCE_MS,
  requestRefusal,
  useRateSuggestion,
  useRequestSuggestion,
  useSuggestions,
} from "@/lib/suggestions";

/**
 * The AI suggestion panel (FR-21, FR-22; ADR-0006, section 11), at the top
 * of the ticket's side rail. It shows the newest draft from the knowledge
 * base with the articles it cites, as plain text, and offers "Insert into
 * reply", which only fills the composer: the agent edits and sends it as
 * their own reply. Nothing here can send anything to the customer.
 */
export function AssistPanel({
  ticket,
  onInsert,
}: {
  ticket: StaffTicket;
  onInsert: (draft: string, suggestionId: string) => void;
}) {
  const can = useCan();
  const headingId = useId();
  const [requestedAt, setRequestedAt] = useState<string>();
  const [gaveUp, setGaveUp] = useState(false);
  const enabled = can("ai:suggestion:read");
  const lastCustomerActivityAt = ticket.messages.reduce(
    (latest, message) =>
      message.author.type === "customer" && message.createdAt > latest
        ? message.createdAt
        : latest,
    ticket.createdAt,
  );
  const suggestions = useSuggestions(
    ticket.id,
    enabled,
    requestedAt,
    lastCustomerActivityAt,
  );
  const request = useRequestSuggestion(ticket.id);

  const items = suggestions.data?.items ?? [];
  const { drafting, shown } = panelState(items, requestedAt);
  const awaiting = requestedAt !== undefined && drafting;

  // Stop waiting for an answer to "Generate" after a while, rather than
  // spinning for ever if the worker is down.
  useEffect(() => {
    if (!awaiting) return;
    const timer = setTimeout(() => {
      setRequestedAt(undefined);
      setGaveUp(true);
    }, REQUEST_PATIENCE_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [awaiting]);

  if (!enabled) return null;

  const canRequest = can("ai:suggestion:request") && ticket.status !== "closed";
  const generate = () => {
    setGaveUp(false);
    request.mutate(undefined, {
      onSuccess: (accepted) => {
        setRequestedAt(accepted.requestedAt);
      },
      onError: (error) => {
        toast.error(requestRefusal(error));
      },
    });
  };

  return (
    <section aria-labelledby={headingId} className="px-4 py-3">
      <div className="flex items-center justify-between gap-2">
        <h2
          id={headingId}
          className="flex items-center gap-1.5 text-sm font-semibold"
        >
          <Sparkles aria-hidden="true" className="size-4 text-primary" />
          Suggested reply
        </h2>
        {canRequest ? (
          <Button
            variant="ghost"
            size="sm"
            className="-mr-2 text-muted-foreground"
            onClick={generate}
            disabled={drafting || request.isPending}
          >
            <RefreshCw aria-hidden="true" />
            {shown === undefined ? "Generate" : "Regenerate"}
          </Button>
        ) : null}
      </div>

      <div aria-live="polite" className="mt-2 space-y-2">
        {suggestions.isPending ? (
          <div aria-busy="true" className="space-y-2">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-20" />
          </div>
        ) : suggestions.isError ? (
          <p className="text-sm text-muted-foreground">
            Suggestions didn&apos;t load.{" "}
            <button
              type="button"
              className="font-medium text-foreground underline underline-offset-2"
              onClick={() => void suggestions.refetch()}
            >
              Try again
            </button>
          </p>
        ) : (
          <>
            {drafting ? (
              <p
                role="status"
                className="flex items-center gap-2 text-sm text-muted-foreground"
              >
                <Spinner className="size-3.5" />
                Drafting from the knowledge base…
              </p>
            ) : null}
            {gaveUp ? (
              <p className="text-sm text-muted-foreground">
                No draft has arrived yet. Try again in a moment.
              </p>
            ) : null}
            {shown === undefined ? (
              drafting ? null : (
                <p className="text-sm text-muted-foreground">
                  No suggestion yet. New tickets and customer messages get one
                  automatically.
                </p>
              )
            ) : (
              <Suggestion
                key={shown.id}
                suggestion={shown}
                stale={drafting}
                canInsert={ticket.allowedActions.reply}
                onInsert={onInsert}
                ticketId={ticket.id}
              />
            )}
          </>
        )}
      </div>

      <p className="mt-3 text-xs leading-snug text-muted-foreground">
        Drafted by AI from the knowledge base. Check it before you send: it
        reaches the customer only if you send it.
      </p>
    </section>
  );
}

function Suggestion({
  suggestion,
  stale,
  canInsert,
  onInsert,
  ticketId,
}: {
  suggestion: AiSuggestion;
  /** A newer draft is being written; this one is still shown meanwhile. */
  stale: boolean;
  canInsert: boolean;
  onInsert: (draft: string, suggestionId: string) => void;
  ticketId: string;
}) {
  switch (suggestion.status) {
    case "ready":
      return (
        <div className="space-y-3">
          <SuggestionDraft suggestion={suggestion} stale={stale} />
          <Actions
            suggestion={suggestion}
            ticketId={ticketId}
            insert={
              <Button
                size="sm"
                disabled={!canInsert || suggestion.draft === null}
                title={canInsert ? undefined : "This ticket can't take replies"}
                onClick={() => {
                  if (suggestion.draft !== null) {
                    onInsert(suggestion.draft, suggestion.id);
                  }
                }}
              >
                <CornerDownLeft aria-hidden="true" />
                Insert into reply
              </Button>
            }
          />
          <Citations citations={suggestion.citations} />
        </div>
      );
    case "no_grounded_answer":
      return (
        <Notice title="No grounded suggestion available">
          The knowledge base doesn&apos;t cover this ticket closely enough to
          draft a reply from it.
        </Notice>
      );
    case "rejected":
      return (
        <Notice title="The last draft was discarded">
          It failed the checks:{" "}
          {suggestion.rejectionReason === null
            ? "it couldn't be verified"
            : REJECTION_TEXT[suggestion.rejectionReason]}
          . Generate another, or reply yourself.
        </Notice>
      );
    case "failed":
      return (
        <Notice title="Suggestions are unavailable right now">
          The AI provider couldn&apos;t be reached. Replying works as normal.
        </Notice>
      );
    case "pending":
      return null;
  }
}

function Notice({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="rounded-md border border-border bg-muted/40 px-3 py-2.5 text-sm">
      <p className="font-medium">{title}</p>
      <p className="mt-0.5 text-muted-foreground">{children}</p>
    </div>
  );
}

/** The part of a heading path after the article's title: the section. */
function sectionOf(citation: AiCitation): string | undefined {
  const parts = citation.headingPath.split(" > ");
  return parts.length > 1 ? parts.slice(1).join(" › ") : undefined;
}

function Citations({ citations }: { citations: readonly AiCitation[] }) {
  if (citations.length === 0) return null;
  return (
    <div>
      <h3 className="text-xs font-medium text-muted-foreground">Sources</h3>
      <ol className="mt-1 space-y-2" aria-label="Sources">
        {citations.map((citation, index) => {
          const section = sectionOf(citation);
          return (
            <li
              key={`${citation.articleId}-${String(index)}`}
              className="text-sm"
            >
              <a
                href={`/kb/${citation.articleId}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 font-medium underline-offset-2 hover:underline"
              >
                {citation.title}
                <ExternalLink
                  aria-hidden="true"
                  className="size-3 text-muted-foreground"
                />
                <span className="sr-only">(opens in a new tab)</span>
              </a>
              {section === undefined ? null : (
                <p className="text-xs text-muted-foreground">{section}</p>
              )}
              {citation.current ? null : (
                <Badge tone="warning" className="mt-1">
                  Changed since this draft
                </Badge>
              )}
              <details className="mt-1 text-xs">
                <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
                  The text it used
                </summary>
                <p className="mt-1 rounded border border-border bg-card px-2 py-1.5 leading-relaxed whitespace-pre-wrap">
                  {citation.excerpt}
                </p>
              </details>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/**
 * The draft's actions: insert it, and rate it with a thumb, saved at once.
 * After a rating, an optional comment can follow, inline.
 */
function Actions({
  suggestion,
  ticketId,
  insert,
}: {
  suggestion: AiSuggestion;
  ticketId: string;
  insert: ReactNode;
}) {
  const can = useCan();
  const rate = useRateSuggestion(ticketId);
  const [commenting, setCommenting] = useState(false);
  const [comment, setComment] = useState("");
  // The thumb just chosen shows at once, before the list is read again.
  const [chosen, setChosen] = useState<"up" | "down">();
  const commentId = useId();
  const current = chosen ?? suggestion.myFeedback?.rating;

  const save = (rating: "up" | "down", text?: string) => {
    rate.mutate(
      {
        suggestionId: suggestion.id,
        rating,
        ...(text === undefined || text.trim() === ""
          ? {}
          : { comment: text.trim() }),
      },
      {
        onSuccess: () => {
          if (text !== undefined) {
            setCommenting(false);
            toast.success("Thanks for the feedback");
          }
        },
        onError: (error) => {
          setChosen(undefined);
          toast.error(error.message);
        },
      },
    );
  };

  const thumb = (rating: "up" | "down") => (
    <Button
      variant="ghost"
      size="sm"
      aria-label={rating === "up" ? "Helpful" : "Not helpful"}
      aria-pressed={current === rating}
      disabled={rate.isPending}
      className={cn(
        "px-2 text-muted-foreground",
        current === rating && "bg-muted text-foreground",
      )}
      onClick={() => {
        setChosen(rating);
        setComment(suggestion.myFeedback?.comment ?? "");
        setCommenting(true);
        save(rating);
      }}
    >
      {rating === "up" ? (
        <ThumbsUp aria-hidden="true" />
      ) : (
        <ThumbsDown aria-hidden="true" />
      )}
    </Button>
  );

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        {insert}
        {can("ai:suggestion:feedback") ? (
          <div className="ml-auto flex items-center">
            {thumb("up")}
            {thumb("down")}
          </div>
        ) : null}
      </div>
      {commenting && current !== undefined ? (
        <form
          noValidate
          className="space-y-2"
          onSubmit={(event) => {
            event.preventDefault();
            save(current, comment);
          }}
        >
          <label htmlFor={commentId} className="text-xs font-medium">
            What was good or wrong?{" "}
            <span className="font-normal text-muted-foreground">
              (optional)
            </span>
          </label>
          <Textarea
            id={commentId}
            size="sm"
            rows={2}
            maxLength={1_000}
            value={comment}
            onChange={(event) => {
              setComment(event.target.value);
            }}
          />
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setCommenting(false);
              }}
            >
              Skip
            </Button>
            <Button type="submit" size="sm" pending={rate.isPending}>
              Send feedback
            </Button>
          </div>
        </form>
      ) : null}
    </>
  );
}
