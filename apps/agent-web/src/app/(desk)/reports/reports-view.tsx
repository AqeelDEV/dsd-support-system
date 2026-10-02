"use client";

import { ok } from "@dsd/api-client";
import {
  BarList,
  cn,
  ColumnChart,
  format,
  Panel,
  PanelHeader,
  Skeleton,
  StatTile,
} from "@dsd/ui";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useSearchParams } from "next/navigation";

import { LoadError, PageBody, PageHeader } from "@/components/page";
import { api } from "@/lib/api";

const RANGES = [7, 30, 90] as const;
type Range = (typeof RANGES)[number];

/** A calendar day as YYYY-MM-DD, `daysAgo` days before today, in the viewer's zone. */
function day(daysAgo: number): string {
  const date = new Date();
  date.setDate(date.getDate() - daysAgo);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

const shortDate = (isoDay: string) =>
  new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(new Date(`${isoDay}T00:00:00Z`));

/**
 * The reporting dashboard (FR-13): volume over time, time to first
 * response, time to resolution and tickets per agent. Every figure is
 * computed by the API (ADR-0012, section 6); this page only draws them.
 */
export function ReportsView() {
  const params = useSearchParams();
  const range: Range =
    RANGES.find((value) => String(value) === params.get("range")) ?? 30;
  const interval = params.get("interval") === "week" ? "week" : "day";
  const query = { from: day(range - 1), to: day(0) };

  const volume = useQuery({
    queryKey: ["reports", "volume", query, interval],
    queryFn: () =>
      ok(
        api.GET("/api/v1/staff/reports/volume", {
          params: { query: { ...query, interval } },
        }),
      ),
  });
  const times = useQuery({
    queryKey: ["reports", "times", query],
    queryFn: () =>
      ok(
        api.GET("/api/v1/staff/reports/response-times", { params: { query } }),
      ),
  });
  const agents = useQuery({
    queryKey: ["reports", "agents", query],
    queryFn: () =>
      ok(api.GET("/api/v1/staff/reports/agents", { params: { query } })),
  });

  const failed = volume.error ?? times.error ?? agents.error;
  const link = (next: { range?: Range; interval?: "day" | "week" }) =>
    `/reports?range=${next.range ?? range}&interval=${next.interval ?? interval}`;
  const segment = (active: boolean) =>
    cn(
      "inline-flex h-7 items-center rounded-[5px] px-2.5 text-xs font-medium",
      active
        ? "bg-card text-foreground shadow-[0_1px_2px_oklch(0_0_0/0.08)]"
        : "text-muted-foreground hover:text-foreground",
    );

  const duration = (seconds: number | null | undefined) =>
    seconds === null || seconds === undefined ? "–" : format.duration(seconds);

  return (
    <>
      <PageHeader
        title="Reports"
        description={
          volume.data === undefined
            ? undefined
            : `${format.date(`${volume.data.from}T12:00:00Z`)} to ${format.date(`${volume.data.to}T12:00:00Z`)}, days in ${volume.data.timeZone}`
        }
        actions={
          <>
            <nav
              aria-label="Date range"
              className="flex rounded-md border border-border bg-muted p-0.5"
            >
              {RANGES.map((value) => (
                <Link
                  key={value}
                  href={link({ range: value })}
                  aria-current={value === range ? "page" : undefined}
                  className={segment(value === range)}
                >
                  {value} days
                </Link>
              ))}
            </nav>
            <nav
              aria-label="Group by"
              className="flex rounded-md border border-border bg-muted p-0.5"
            >
              {(["day", "week"] as const).map((value) => (
                <Link
                  key={value}
                  href={link({ interval: value })}
                  aria-current={value === interval ? "page" : undefined}
                  className={segment(value === interval)}
                >
                  By {value}
                </Link>
              ))}
            </nav>
          </>
        }
      />
      <PageBody className="flex flex-col gap-4">
        {failed !== null ? (
          <Panel>
            <LoadError
              error={failed}
              what="reports"
              onRetry={() => {
                void volume.refetch();
                void times.refetch();
                void agents.refetch();
              }}
            />
          </Panel>
        ) : (
          <>
            <Panel>
              <dl className="grid grid-cols-2 divide-border lg:grid-cols-4 lg:divide-x [&>div:nth-child(-n+2)]:border-b [&>div:nth-child(-n+2)]:border-border lg:[&>div]:border-b-0">
                {volume.data === undefined || times.data === undefined ? (
                  Array.from({ length: 4 }, (_, index) => (
                    <div key={index} className="space-y-2 px-4 py-3.5">
                      <Skeleton className="h-3 w-24" />
                      <Skeleton className="h-6 w-16" />
                    </div>
                  ))
                ) : (
                  <>
                    <StatTile
                      label="Tickets received"
                      value={format.count(volume.data.total)}
                    />
                    <StatTile
                      label="First response (median)"
                      value={duration(times.data.firstResponse.medianSeconds)}
                      detail={`Mean ${duration(times.data.firstResponse.meanSeconds)} over ${format.count(times.data.firstResponse.ticketCount)} tickets`}
                    />
                    <StatTile
                      label="Resolution (median)"
                      value={duration(times.data.resolution.medianSeconds)}
                      detail={`Mean ${duration(times.data.resolution.meanSeconds)} over ${format.count(times.data.resolution.ticketCount)} tickets`}
                    />
                    <StatTile
                      label="Awaiting a first response"
                      value={format.count(
                        times.data.firstResponse.awaitingFirstResponse,
                      )}
                      detail="Open tickets nobody has answered yet"
                    />
                  </>
                )}
              </dl>
            </Panel>

            <Panel>
              <PanelHeader
                title="Ticket volume"
                description={`Tickets received per ${interval}`}
              />
              <div className="p-4">
                {volume.data === undefined ? (
                  <Skeleton className="h-48" />
                ) : (
                  <ColumnChart
                    caption={`Tickets received per ${interval}`}
                    valueLabel="Tickets"
                    data={volume.data.buckets.map((bucket) => ({
                      label:
                        interval === "week"
                          ? `Week of ${shortDate(bucket.start)}`
                          : shortDate(bucket.start),
                      axisLabel: shortDate(bucket.start),
                      value: bucket.count,
                    }))}
                  />
                )}
              </div>
            </Panel>

            <div className="grid gap-4 lg:grid-cols-2">
              <Panel>
                <PanelHeader
                  title="Open tickets per agent"
                  description="What each person holds right now"
                />
                <div className="p-4">
                  {agents.data === undefined ? (
                    <Skeleton className="h-32" />
                  ) : agents.data.agents.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      Nobody holds an open ticket.
                    </p>
                  ) : (
                    <BarList
                      caption="Open tickets per agent"
                      valueLabel="Open tickets"
                      data={agents.data.agents.map((row) => ({
                        label: row.agent.active
                          ? row.agent.displayName
                          : `${row.agent.displayName} (deactivated)`,
                        value: row.openAssigned,
                      }))}
                    />
                  )}
                </div>
              </Panel>
              <Panel>
                <PanelHeader
                  title="Resolved per agent"
                  description="Tickets resolved in this period"
                />
                <div className="p-4">
                  {agents.data === undefined ? (
                    <Skeleton className="h-32" />
                  ) : (
                    <BarList
                      caption="Tickets resolved per agent in the period"
                      valueLabel="Resolved"
                      data={agents.data.agents.map((row) => ({
                        label: row.agent.active
                          ? row.agent.displayName
                          : `${row.agent.displayName} (deactivated)`,
                        value: row.resolvedInRange,
                      }))}
                    />
                  )}
                </div>
              </Panel>
            </div>
          </>
        )}
      </PageBody>
    </>
  );
}
