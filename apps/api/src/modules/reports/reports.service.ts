import { Inject, Injectable } from "@nestjs/common";
import {
  type AgentsReport,
  MAX_REPORT_DAYS,
  type ReportRangeQuery,
  type ResponseTimesReport,
  type VolumeQuery,
  type VolumeReport,
} from "@dsd/shared";
import { ZodValidationException } from "nestjs-zod";
import { z } from "zod";

import type { StaffPrincipal } from "../../auth/principal.js";
import type { Env } from "../../config/env.js";
import type { Executor } from "../../infrastructure/database.js";
import { DB, ENV } from "../../infrastructure/tokens.js";
import { type ReportRange, ReportsRepository } from "./reports.repository.js";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Today's date in `timeZone`, as YYYY-MM-DD. */
function today(timeZone: string): string {
  // en-CA formats dates as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

const addDays = (date: string, days: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS)
    .toISOString()
    .slice(0, 10);

const daysBetween = (from: string, to: string) =>
  Math.round(
    (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS,
  );

const badRange = (message: string) =>
  new ZodValidationException(
    new z.ZodError([
      { code: "custom", path: ["from"], message, input: undefined },
    ]),
  );

/**
 * Reporting (FR-13; ADR-0007, section 9). Every figure is computed in SQL
 * over the viewer's brands for whole days in the reporting time zone, in
 * calendar time. Without dates, the range is the last 30 days, today
 * included.
 */
@Injectable()
export class ReportsService {
  constructor(
    @Inject(DB) private readonly db: Executor,
    @Inject(ENV) private readonly env: Env,
    private readonly reports: ReportsRepository,
  ) {}

  async volume(
    principal: StaffPrincipal,
    query: VolumeQuery,
  ): Promise<VolumeReport> {
    const range = this.rangeOf(query);
    const buckets = await this.reports.volume(
      this.db,
      principal.agent.id,
      range,
      query.interval,
    );
    return {
      ...range,
      interval: query.interval,
      total: buckets.reduce((sum, bucket) => sum + bucket.count, 0),
      buckets,
    };
  }

  async responseTimes(
    principal: StaffPrincipal,
    query: ReportRangeQuery,
  ): Promise<ResponseTimesReport> {
    const range = this.rangeOf(query);
    const [first, resolution] = await Promise.all([
      this.reports.firstResponses(this.db, principal.agent.id, range),
      this.reports.resolutions(this.db, principal.agent.id, range),
    ]);
    const { awaiting, ...firstResponse } = first;
    return {
      ...range,
      firstResponse: { ...firstResponse, awaitingFirstResponse: awaiting },
      resolution,
    };
  }

  async agents(
    principal: StaffPrincipal,
    query: ReportRangeQuery,
  ): Promise<AgentsReport> {
    const range = this.rangeOf(query);
    const rows = await this.reports.perAgent(
      this.db,
      principal.agent.id,
      range,
    );
    return {
      ...range,
      agents: rows.map(({ openAssigned, resolvedInRange, ...agent }) => ({
        agent,
        openAssigned,
        resolvedInRange,
      })),
    };
  }

  /** The range asked for, with defaults filled in, checked for order and length. */
  private rangeOf(query: ReportRangeQuery): ReportRange {
    const timeZone = this.env.REPORTING_TIMEZONE;
    const to = query.to ?? today(timeZone);
    const from = query.from ?? addDays(to, -29);
    const days = daysBetween(from, to) + 1;
    if (days < 1) throw badRange("`from` must not be after `to`");
    if (days > MAX_REPORT_DAYS) {
      throw badRange(`A report covers at most ${MAX_REPORT_DAYS} days`);
    }
    return { from, to, timeZone };
  }
}
