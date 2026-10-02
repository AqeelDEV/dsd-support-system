/*
 * Formatting for display only. Times are shown in the viewer's own time
 * zone and locale; the API sends ISO timestamps.
 */

const RELATIVE = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

const STEPS: readonly [Intl.RelativeTimeFormatUnit, number][] = [
  ["second", 60],
  ["minute", 60],
  ["hour", 24],
  ["day", 7],
  ["week", 4.345],
  ["month", 12],
  ["year", Number.POSITIVE_INFINITY],
];

/** "just now", "5 minutes ago", "yesterday", "3 weeks ago". */
export function relativeTime(iso: string, now: number = Date.now()): string {
  let value = (new Date(iso).getTime() - now) / 1000;
  if (Math.abs(value) < 45) return "just now";
  for (const [unit, size] of STEPS) {
    if (Math.abs(value) < size) {
      return RELATIVE.format(Math.round(value), unit);
    }
    value /= size;
  }
  return RELATIVE.format(Math.round(value), "year");
}

/** "2 Oct 2026, 14:05" in the viewer's zone. */
export function dateTime(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

/** "2 Oct 2026". */
export function date(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(iso));
}

/** "1.2 MB", "340 KB", "12 bytes". */
export function bytes(size: number): string {
  if (size < 1024) return `${size} ${size === 1 ? "byte" : "bytes"}`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1).replace(/\.0$/, "")} MB`;
}

/** A length of time for reports: "45s", "12m", "3h 20m", "2d 4h". */
export function duration(seconds: number): string {
  const s = Math.round(seconds);
  if (s < 60) return `${s}s`;
  const minutes = Math.round(s / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    const rest = minutes % 60;
    return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
  }
  const days = Math.floor(hours / 24);
  const rest = hours % 24;
  return rest === 0 ? `${days}d` : `${days}d ${rest}h`;
}

export const count = (value: number) =>
  new Intl.NumberFormat("en-GB").format(value);
