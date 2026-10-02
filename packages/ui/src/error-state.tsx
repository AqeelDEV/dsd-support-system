"use client";

import { RotateCcw, ShieldAlert, WifiOff, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "./button";
import { cn } from "./cn";

/**
 * What a page or panel shows when its data couldn't be loaded. It says
 * what happened in plain words, offers a retry when one can help, and shows
 * the request ID so a support conversation can find the server's log line.
 */
export function ErrorState({
  title = "This didn't load",
  description = "Something went wrong on our side. Try again in a moment.",
  requestId,
  onRetry,
  icon,
  action,
  className,
}: {
  title?: ReactNode;
  description?: ReactNode;
  requestId?: string | undefined;
  onRetry?: (() => void) | undefined;
  icon?: "error" | "offline" | "forbidden";
  action?: ReactNode;
  className?: string;
}) {
  const Icon: LucideIcon =
    icon === "offline"
      ? WifiOff
      : icon === "forbidden"
        ? ShieldAlert
        : RotateCcw;
  return (
    <div
      role="alert"
      className={cn(
        "flex flex-col items-center px-6 py-12 text-center",
        className,
      )}
    >
      <span className="mb-4 grid size-10 place-items-center rounded-lg border border-border bg-muted text-muted-foreground">
        <Icon aria-hidden="true" className="size-5" />
      </span>
      <p className="text-base font-semibold">{title}</p>
      <p className="mt-1 max-w-sm text-sm text-muted-foreground">
        {description}
      </p>
      {onRetry === undefined && action === undefined ? null : (
        <div className="mt-5 flex gap-2">
          {onRetry === undefined ? null : (
            <Button variant="secondary" size="sm" onClick={onRetry}>
              Try again
            </Button>
          )}
          {action}
        </div>
      )}
      {requestId === undefined ? null : (
        <p className="mt-4 font-mono text-[0.6875rem] text-subtle">
          Reference: {requestId}
        </p>
      )}
    </div>
  );
}
