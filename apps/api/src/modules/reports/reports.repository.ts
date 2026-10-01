import { Injectable } from "@nestjs/common";
import type { AgentRole } from "@dsd/shared";
import { sql } from "drizzle-orm";

import type { Executor } from "../../infrastructure/database.js";

/** A reporting range: whole days in a time zone, `to` included. */
export interface ReportRange {
  from: string;
  to: string;
  timeZone: string;
}

/** The viewer's brands, as a subquery: reports cover nothing else (ADR-0004, section 6). */
const viewerBrands = (agentId: string) =>
  sql`(SELECT brand_id FROM agent_brand_memberships WHERE agent_id = ${agentId})`;

/** The instants the range starts and ends at: local midnight on `from`, and after `to`. */
const lowerBound = (range: ReportRange) =>
  sql`((${range.from}::date)::timestamp AT TIME ZONE ${range.timeZone})`;
const upperBound = (range: ReportRange) =>
  sql`(((${range.to}::date) + 1)::timestamp AT TIME ZONE ${range.timeZone})`;

/** Seconds between two timestamps, as float8 so the driver hands back a number. */
const seconds = (later: string, earlier: string) =>
  sql.raw(`extract(epoch FROM ${later} - ${earlier})::float8`);

export interface Durations {
  ticketCount: number;
  meanSeconds: number | null;
  medianSeconds: number | null;
}

/** The same shape as a row type: the driver needs an object literal type. */
type DurationsRow = {
  [Key in keyof Durations]: Durations[Key];
};

/**
 * The reporting queries (FR-13; ADR-0007, section 9). Each is one SQL
 * statement over the viewer's brands, using the indexes on
 * `(brand_id, created_at)` and `(brand_id, resolved_at)`. At much larger
 * volumes these move to rollup tables kept by the worker.
 */
@Injectable()
export class ReportsRepository {
  /** Tickets created per day or week, every bucket in the range included. */
  async volume(
    executor: Executor,
    agentId: string,
    range: ReportRange,
    interval: "day" | "week",
  ): Promise<{ start: string; count: number }[]> {
    const result = await executor.execute<{ start: string; count: number }>(sql`
      WITH counts AS (
        SELECT date_trunc(${interval}, t.created_at AT TIME ZONE ${range.timeZone})::date AS start,
               count(*)::int AS count
          FROM tickets t
         WHERE t.brand_id IN ${viewerBrands(agentId)}
           AND t.created_at >= ${lowerBound(range)}
           AND t.created_at < ${upperBound(range)}
         GROUP BY 1
      )
      SELECT to_char(s.start, 'YYYY-MM-DD') AS start, coalesce(c.count, 0)::int AS count
        FROM generate_series(
               date_trunc(${interval}, (${range.from}::date)::timestamp),
               (${range.to}::date)::timestamp,
               ('1 ' || ${interval})::interval
             ) AS s(start)
        LEFT JOIN counts c ON c.start = s.start::date
       ORDER BY s.start`);
    return result.rows;
  }

  /**
   * First responses for tickets created in the range, and how many of
   * those (not closed) are still waiting for one.
   */
  async firstResponses(
    executor: Executor,
    agentId: string,
    range: ReportRange,
  ): Promise<Durations & { awaiting: number }> {
    const wait = seconds("first_response_at", "created_at");
    const result = await executor.execute<
      DurationsRow & { awaiting: number }
    >(sql`
      SELECT count(*) FILTER (WHERE first_response_at IS NOT NULL)::int AS "ticketCount",
             avg(${wait}) FILTER (WHERE first_response_at IS NOT NULL) AS "meanSeconds",
             percentile_cont(0.5) WITHIN GROUP (ORDER BY ${wait})
               FILTER (WHERE first_response_at IS NOT NULL) AS "medianSeconds",
             count(*) FILTER (WHERE first_response_at IS NULL AND status <> 'closed')::int AS awaiting
        FROM tickets
       WHERE brand_id IN ${viewerBrands(agentId)}
         AND created_at >= ${lowerBound(range)}
         AND created_at < ${upperBound(range)}`);
    const [row] = result.rows;
    if (row === undefined) throw new Error("aggregate returned no row");
    return row;
  }

  /** Time to resolution for tickets whose latest resolution falls in the range. */
  async resolutions(
    executor: Executor,
    agentId: string,
    range: ReportRange,
  ): Promise<Durations> {
    const time = seconds("resolved_at", "created_at");
    const result = await executor.execute<DurationsRow>(sql`
      SELECT count(*)::int AS "ticketCount",
             avg(${time}) AS "meanSeconds",
             percentile_cont(0.5) WITHIN GROUP (ORDER BY ${time}) AS "medianSeconds"
        FROM tickets
       WHERE brand_id IN ${viewerBrands(agentId)}
         AND resolved_at >= ${lowerBound(range)}
         AND resolved_at < ${upperBound(range)}`);
    const [row] = result.rows;
    if (row === undefined) throw new Error("aggregate returned no row");
    return row;
  }

  /**
   * For each colleague in the viewer's brands: the open work they hold now,
   * and the tickets they hold whose latest resolution is in the range.
   * Deactivated agents appear only while they still have something to show.
   */
  async perAgent(
    executor: Executor,
    agentId: string,
    range: ReportRange,
  ): Promise<
    {
      id: string;
      displayName: string;
      role: AgentRole;
      active: boolean;
      openAssigned: number;
      resolvedInRange: number;
    }[]
  > {
    const result = await executor.execute<{
      id: string;
      displayName: string;
      role: AgentRole;
      active: boolean;
      openAssigned: number;
      resolvedInRange: number;
    }>(sql`
      SELECT a.id, a.display_name AS "displayName", a.role,
             a.deactivated_at IS NULL AS active,
             count(t.id) FILTER (WHERE t.status IN ('open', 'pending_customer'))::int AS "openAssigned",
             count(t.id) FILTER (
               WHERE t.resolved_at >= ${lowerBound(range)} AND t.resolved_at < ${upperBound(range)}
             )::int AS "resolvedInRange"
        FROM agents a
        LEFT JOIN tickets t
               ON t.assignee_agent_id = a.id AND t.brand_id IN ${viewerBrands(agentId)}
       WHERE EXISTS (
               SELECT 1 FROM agent_brand_memberships m
                WHERE m.agent_id = a.id AND m.brand_id IN ${viewerBrands(agentId)}
             )
       GROUP BY a.id
      HAVING a.deactivated_at IS NULL
          OR count(t.id) FILTER (
               WHERE t.status IN ('open', 'pending_customer')
                  OR (t.resolved_at >= ${lowerBound(range)} AND t.resolved_at < ${upperBound(range)})
             ) > 0
       ORDER BY a.display_name, a.id`);
    return result.rows;
  }
}
