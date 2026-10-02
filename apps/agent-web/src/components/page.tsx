"use client";

import { ApiProblem } from "@dsd/api-client";
import { cn, describeProblem, ErrorState } from "@dsd/ui";
import type { ReactNode } from "react";

/**
 * A page's header bar: title on the left, actions on the right, optional
 * tabs or filters underneath. Hairline-separated, no card (ADR-0013).
 */
export function PageHeader({
  title,
  description,
  actions,
  children,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <header className={cn("border-b border-border bg-card", className)}>
      <div className="flex min-h-14 flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-2.5 sm:px-6">
        <div className="min-w-0">
          <h1 className="truncate text-lg font-semibold">{title}</h1>
          {description === undefined ? null : (
            <p className="text-sm text-muted-foreground">{description}</p>
          )}
        </div>
        {actions === undefined ? null : (
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {actions}
          </div>
        )}
      </div>
      {children === undefined ? null : (
        <div className="px-4 sm:px-6">{children}</div>
      )}
    </header>
  );
}

/** The body of a page, on the canvas. */
export function PageBody({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={cn("flex-1 p-4 sm:p-6", className)}>{children}</div>;
}

/**
 * A failed read: "you don't have access" for a 403 (the API decided, the
 * nav merely hid the link), otherwise the problem in plain words.
 */
export function LoadError({
  error,
  onRetry,
  what = "this page",
}: {
  error: unknown;
  onRetry?: () => void;
  what?: string;
}) {
  if (error instanceof ApiProblem && error.status === 403) {
    return (
      <ErrorState
        icon="forbidden"
        title="You don't have access"
        description={`Your role doesn't include ${what}. Ask a supervisor or an admin if you need it.`}
      />
    );
  }
  const message = describeProblem(error);
  return <ErrorState {...message} onRetry={onRetry} />;
}
