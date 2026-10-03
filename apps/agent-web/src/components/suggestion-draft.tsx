import type { AiSuggestion } from "@dsd/shared";
import { Badge, cn } from "@dsd/ui";

import { draftOrigin } from "@/lib/suggestions";

/**
 * A ready draft as the agent reads it (ADR-0006, section 11): who wrote it,
 * then its text. The text is a React text node, never markup, so a draft
 * that quotes HTML from a ticket shows the characters and runs nothing.
 */
export function SuggestionDraft({
  suggestion,
  stale = false,
}: {
  suggestion: Pick<AiSuggestion, "provider" | "model" | "draft">;
  /** A newer draft is being written; this one is still shown meanwhile. */
  stale?: boolean;
}) {
  const origin = draftOrigin(suggestion);
  return (
    <div className={cn("space-y-2", stale && "opacity-70")}>
      {origin.kind === "mock" ? (
        <div
          className="rounded-md border border-tone-warning/40 bg-tone-warning-soft px-3 py-2 text-xs leading-snug text-tone-warning-fg"
          data-testid="draft-origin"
        >
          <Badge tone="warning" className="mr-1.5">
            Mock draft
          </Badge>
          Written by the offline mock, not an AI model: it stitches together
          sentences from the cited articles. Configure an AI provider for real
          drafts.
        </div>
      ) : (
        <p className="text-xs text-muted-foreground" data-testid="draft-origin">
          Drafted by {origin.model}
        </p>
      )}
      <div
        className="max-h-72 overflow-y-auto rounded-md border border-border bg-muted/40 px-3 py-2.5 text-sm leading-relaxed break-words whitespace-pre-wrap"
        data-testid="suggestion-draft"
      >
        {suggestion.draft}
      </div>
    </div>
  );
}
