"use client";

import { useEffect, useState } from "react";

import { cn } from "./cn";
import { dateTime, relativeTime } from "./format";

/**
 * "5 minutes ago", kept fresh once a minute, with the exact time in the
 * tooltip and in `dateTime` for assistive technology.
 */
export function RelativeTime({
  value,
  className,
}: {
  value: string;
  className?: string;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => {
      setNow(Date.now());
    }, 60_000);
    return () => {
      clearInterval(timer);
    };
  }, []);
  return (
    <time
      dateTime={value}
      title={dateTime(value)}
      className={cn("tabular whitespace-nowrap", className)}
      suppressHydrationWarning
    >
      {relativeTime(value, now)}
    </time>
  );
}
