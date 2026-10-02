"use client";

import type { KbPublicArticleSummary, SnippetSegment } from "@dsd/shared";
import { cn, Input } from "@dsd/ui";
import { ChevronRight, Search } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

/**
 * A search snippet. The API marks the matched words as segments
 * (ADR-0012, section 3); this wraps them in its own <mark>, so no markup
 * from the server ever reaches the page.
 */
export function Snippet({ segments }: { segments: readonly SnippetSegment[] }) {
  return (
    <>
      {segments.map(withoutMarkup).map((segment, index) =>
        segment.highlighted ? (
          <mark
            key={index}
            className="rounded-[3px] bg-tone-warning-soft px-0.5 text-foreground"
          >
            {segment.text}
          </mark>
        ) : (
          segment.text
        ),
      )}
    </>
  );
}

/**
 * Snippets are quoted from the article's markdown source, so they can hold
 * heading and emphasis markers. Those read as noise in a one-line preview.
 */
function withoutMarkup(segment: SnippetSegment): SnippetSegment {
  return {
    highlighted: segment.highlighted,
    text: segment.text.replace(/[#*_`>|]+/g, "").replace(/\s+/g, " "),
  };
}

export function ArticleRow({
  article,
  compact = false,
}: {
  article: KbPublicArticleSummary;
  /** The submit form's suggestions: opens in a new tab so the draft survives. */
  compact?: boolean;
}) {
  return (
    <li>
      <Link
        href={`/help/${article.slug}`}
        {...(compact ? { target: "_blank", rel: "noopener" } : {})}
        className={cn(
          "group flex items-start gap-4 transition-colors hover:bg-muted/60",
          compact ? "px-4 py-3" : "px-5 py-4",
        )}
      >
        <div className="min-w-0 flex-1">
          <p
            className={cn(
              "font-medium text-foreground group-hover:text-primary",
              compact && "text-base",
            )}
          >
            {article.title}
            {compact ? (
              <span className="sr-only"> (opens in a new tab)</span>
            ) : null}
          </p>
          <p
            className={cn(
              "mt-1 text-muted-foreground",
              compact ? "line-clamp-2 text-sm" : "line-clamp-2 text-base",
            )}
          >
            {article.snippet === null ? (
              article.summary
            ) : (
              <Snippet segments={article.snippet} />
            )}
          </p>
          {compact || article.category === null ? null : (
            <p className="mt-2 text-xs text-subtle">{article.category.name}</p>
          )}
        </div>
        <ChevronRight
          aria-hidden="true"
          className="mt-1 size-4 shrink-0 text-subtle transition-transform group-hover:translate-x-0.5"
        />
      </Link>
    </li>
  );
}

/** The help-centre search box. It navigates to /help?q=…, so a search can be shared or bookmarked. */
export function HelpSearch({
  initial = "",
  size = "lg",
  autoFocus = false,
  className,
}: {
  initial?: string;
  size?: "md" | "lg";
  autoFocus?: boolean;
  className?: string;
}) {
  const router = useRouter();
  const [query, setQuery] = useState(initial);
  return (
    <form
      role="search"
      className={cn("relative", className)}
      onSubmit={(event) => {
        event.preventDefault();
        const q = query.trim();
        router.push(q === "" ? "/help" : `/help?q=${encodeURIComponent(q)}`);
      }}
    >
      <label htmlFor="help-search" className="sr-only">
        Search the help centre
      </label>
      <Search
        aria-hidden="true"
        className={cn(
          "pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-subtle",
          size === "lg" ? "size-5" : "size-4",
        )}
      />
      <Input
        id="help-search"
        type="search"
        size={size}
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
        }}
        placeholder="Search for answers, e.g. reset my hub"
        maxLength={200}
        autoComplete="off"
        // eslint-disable-next-line jsx-a11y/no-autofocus -- the help page's one job is search
        autoFocus={autoFocus}
        className={cn(size === "lg" ? "h-12 pl-11 text-md" : "pl-9")}
      />
    </form>
  );
}
