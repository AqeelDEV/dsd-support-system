"use client";

import { Check, Copy } from "lucide-react";
import { useEffect, useState } from "react";

import { cn } from "./cn";

/**
 * A ticket reference (`DSD-000123`) as a monospace chip that can be copied:
 * the recurring anchor between a customer's email, their thread and the
 * agent's queue (ADR-0013, signature detail 1).
 */
export function ReferenceChip({
  reference,
  copyable = true,
  className,
}: {
  reference: string;
  copyable?: boolean;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return undefined;
    const timer = setTimeout(() => {
      setCopied(false);
    }, 1500);
    return () => {
      clearTimeout(timer);
    };
  }, [copied]);

  const chip =
    "inline-flex h-5 shrink-0 items-center gap-1 whitespace-nowrap rounded-sm border border-border-strong bg-muted px-1.5 font-mono text-[0.6875rem] leading-none font-medium tracking-tight text-muted-foreground shadow-[inset_0_1px_0_oklch(0_0_0/0.04)] tabular";

  if (!copyable) {
    return <span className={cn(chip, className)}>{reference}</span>;
  }

  return (
    <button
      type="button"
      className={cn(
        chip,
        "cursor-copy transition-colors hover:border-input hover:text-foreground",
        className,
      )}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        // The clipboard API exists only in secure contexts (https, localhost).
        if (!("clipboard" in navigator)) return;
        void navigator.clipboard.writeText(reference).then(() => {
          setCopied(true);
        });
      }}
      aria-label={
        copied ? `${reference} copied` : `Copy reference ${reference}`
      }
    >
      {reference}
      {copied ? (
        <Check aria-hidden="true" className="size-3 text-tone-success" />
      ) : (
        <Copy aria-hidden="true" className="size-3 opacity-60" />
      )}
    </button>
  );
}
