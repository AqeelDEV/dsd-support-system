import type { ReactNode } from "react";

import { cn } from "./cn";
import { count as formatCount } from "./format";

/*
 * Small, hand-drawn charts for the reporting dashboard (ADR-0013). They are
 * plain SVG and HTML on the design tokens, so they follow the theme and the
 * dark mode with no chart library. Each one carries the same numbers as a
 * visually hidden table, which is what a screen reader reads.
 */

export interface BarDatum {
  label: string;
  /** A shorter label for the axis, e.g. "2 Oct". */
  axisLabel?: string;
  value: number;
}

/** A column chart for a series over time. */
export function ColumnChart({
  data,
  caption,
  valueLabel,
  height = 180,
}: {
  data: readonly BarDatum[];
  caption: string;
  valueLabel: string;
  height?: number;
}) {
  const max = Math.max(1, ...data.map((datum) => datum.value));
  const ticks = niceTicks(max);
  const top = ticks.at(-1) ?? max;
  // Label at most ~8 columns so the axis never crowds.
  const every = Math.max(1, Math.ceil(data.length / 8));

  return (
    <figure className="flex flex-col gap-2">
      <div className="flex gap-2">
        <div
          aria-hidden="true"
          className="flex flex-col-reverse justify-between pb-6 text-right text-[0.6875rem] text-subtle tabular"
          style={{ height }}
        >
          {ticks.map((tick) => (
            <span key={tick} className="-my-1.5 leading-3">
              {formatCount(tick)}
            </span>
          ))}
        </div>
        <div className="relative min-w-0 flex-1" aria-hidden="true">
          <div className="absolute inset-x-0 top-0 bottom-6 flex flex-col-reverse justify-between">
            {ticks.map((tick) => (
              <div key={tick} className="h-px w-full bg-border" />
            ))}
          </div>
          <div className="relative flex items-end gap-[2px]" style={{ height }}>
            {data.map((datum, index) => (
              <div
                key={datum.label}
                className="group relative flex h-full min-w-0 flex-1 flex-col justify-end pb-6"
              >
                <div
                  className="w-full rounded-t-[3px] bg-chart transition-opacity group-hover:opacity-80"
                  style={{
                    height: `${(datum.value / top) * 100}%`,
                    minHeight: datum.value > 0 ? 2 : 0,
                  }}
                />
                <span className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 hidden -translate-x-1/2 rounded-md bg-foreground px-2 py-1 text-[0.6875rem] whitespace-nowrap text-background group-hover:block">
                  {datum.label}: {formatCount(datum.value)}
                </span>
                {index % every === 0 ? (
                  <span className="absolute bottom-0 left-1/2 -translate-x-1/2 text-[0.6875rem] whitespace-nowrap text-subtle">
                    {datum.axisLabel ?? datum.label}
                  </span>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      </div>
      <DataTable caption={caption} valueLabel={valueLabel} data={data} />
    </figure>
  );
}

/** Horizontal bars for comparing a few named things, e.g. agents. */
export function BarList({
  data,
  caption,
  valueLabel,
  format = formatCount,
}: {
  data: readonly BarDatum[];
  caption: string;
  valueLabel: string;
  format?: (value: number) => string;
}) {
  const max = Math.max(1, ...data.map((datum) => datum.value));
  return (
    <figure>
      <ul aria-hidden="true" className="flex flex-col gap-2.5">
        {data.map((datum) => (
          <li
            key={datum.label}
            className="grid grid-cols-[minmax(0,9rem)_1fr_3rem] items-center gap-3 text-sm"
          >
            <span className="truncate">{datum.label}</span>
            <span className="h-2 overflow-hidden rounded-full bg-chart-muted">
              <span
                className="block h-full rounded-full bg-chart"
                style={{ width: `${(datum.value / max) * 100}%` }}
              />
            </span>
            <span className="text-right tabular text-muted-foreground">
              {format(datum.value)}
            </span>
          </li>
        ))}
      </ul>
      <DataTable
        caption={caption}
        valueLabel={valueLabel}
        data={data}
        format={format}
      />
    </figure>
  );
}

function DataTable({
  caption,
  valueLabel,
  data,
  format = formatCount,
}: {
  caption: string;
  valueLabel: string;
  data: readonly BarDatum[];
  format?: (value: number) => string;
}) {
  return (
    <table className="sr-only">
      <caption>{caption}</caption>
      <thead>
        <tr>
          <th scope="col">Period</th>
          <th scope="col">{valueLabel}</th>
        </tr>
      </thead>
      <tbody>
        {data.map((datum) => (
          <tr key={datum.label}>
            <th scope="row">{datum.label}</th>
            <td>{format(datum.value)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Up to five round tick values from zero that cover `max`. */
export function niceTicks(max: number): number[] {
  if (max <= 4)
    return Array.from({ length: Math.max(1, Math.ceil(max)) + 1 }, (_, i) => i);
  const rough = max / 4;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const step =
    [1, 2, 2.5, 5, 10]
      .map((factor) => factor * magnitude)
      .find((candidate) => candidate >= rough) ?? 10 * magnitude;
  const ticks: number[] = [];
  for (let value = 0; value < max + step; value += step) {
    ticks.push(Math.round(value * 100) / 100);
    if (value >= max) break;
  }
  return ticks;
}

/** One headline figure with its label and an optional secondary line. */
export function StatTile({
  label,
  value,
  detail,
  className,
}: {
  label: ReactNode;
  value: ReactNode;
  detail?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-1 px-4 py-3.5", className)}>
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className="text-xl font-semibold tracking-tight tabular">{value}</dd>
      {detail === undefined ? null : (
        <dd className="text-xs text-muted-foreground">{detail}</dd>
      )}
    </div>
  );
}
