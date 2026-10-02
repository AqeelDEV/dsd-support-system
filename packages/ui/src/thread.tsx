import { Lock } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "./cn";
import { RelativeTime } from "./relative-time";
import { Avatar } from "./surfaces";

/*
 * The status rail (ADR-0013, signature detail 2): a ticket's history hangs
 * off one thin vertical line. Messages carry the author's initials on the
 * rail; status changes sit on it as small markers, so the history reads as
 * one continuous story. Internal notes are on a warm amber surface so they
 * can never be mistaken for a reply.
 */

export function Thread({
  children,
  className,
  label = "Conversation",
}: {
  children: ReactNode;
  className?: string;
  label?: string;
}) {
  return (
    <ol
      aria-label={label}
      className={cn(
        "relative flex flex-col gap-5 before:absolute before:top-4 before:bottom-4 before:left-[15.5px] before:w-px before:bg-border",
        className,
      )}
    >
      {children}
    </ol>
  );
}

export function ThreadMessage({
  author,
  tag,
  createdAt,
  body,
  attachments,
  variant = "message",
  emphasis = false,
}: {
  author: string;
  /** A short role label after the name: "Support", "You", "Customer". */
  tag?: ReactNode;
  createdAt: string;
  body: string;
  attachments?: ReactNode;
  variant?: "message" | "note";
  /** The other side's messages, shown on a card; one's own sit on the canvas. */
  emphasis?: boolean;
}) {
  const note = variant === "note";
  return (
    <li className="relative pl-12">
      <Avatar
        name={author}
        className="absolute top-0 left-0 ring-4 ring-background"
      />
      <article
        className={cn(
          "rounded-lg border px-4 py-3",
          note
            ? "border-note-border bg-note text-note-foreground"
            : emphasis
              ? "border-border bg-card"
              : "border-border bg-muted/40",
        )}
      >
        <header className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <h3 className="text-sm font-semibold">{author}</h3>
          {tag === undefined ? null : (
            <span className="text-xs text-muted-foreground">{tag}</span>
          )}
          {note ? (
            <span className="inline-flex items-center gap-1 text-xs font-medium">
              <Lock aria-hidden="true" className="size-3" />
              Internal note
            </span>
          ) : null}
          <RelativeTime
            value={createdAt}
            className="ml-auto text-xs text-muted-foreground"
          />
        </header>
        <div className="mt-1.5 text-[length:inherit] leading-relaxed break-words whitespace-pre-wrap">
          {body}
        </div>
        {attachments === undefined ? null : (
          <div className="mt-3">{attachments}</div>
        )}
      </article>
    </li>
  );
}

/** A status change or other event, as a marker on the rail. */
export function ThreadEvent({
  children,
  at,
  tone = "neutral",
}: {
  children: ReactNode;
  at: string;
  tone?: "neutral" | "info" | "success" | "warning";
}) {
  return (
    <li className="relative flex min-h-5 items-center gap-2 pl-12 text-xs text-muted-foreground">
      <span
        aria-hidden="true"
        className={cn(
          "absolute top-1/2 left-[11px] size-2.5 -translate-y-1/2 rounded-full border-2 border-background ring-1",
          tone === "neutral" && "bg-tone-neutral ring-tone-neutral/40",
          tone === "info" && "bg-tone-info ring-tone-info/40",
          tone === "success" && "bg-tone-success ring-tone-success/40",
          tone === "warning" && "bg-tone-warning ring-tone-warning/40",
        )}
      />
      <span className="min-w-0">{children}</span>
      <span aria-hidden="true">·</span>
      <RelativeTime value={at} />
    </li>
  );
}
