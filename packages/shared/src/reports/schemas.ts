import { z } from "zod";

import { agentRoleSchema } from "../domain/enums.js";

/*
 * Reporting (FR-13; ADR-0007, section 9, amended in ADR-0012). Dates are
 * calendar days in the reporting time zone, inclusive at both ends; times
 * are calendar time in seconds, with no business hours.
 */

const date = z.iso
  .date()
  .describe("A calendar day in the reporting time zone, like 2026-09-30");

/** At most a year and a day, so one request can't scan years of tickets. */
export const MAX_REPORT_DAYS = 366;

export const reportRangeQuerySchema = z.strictObject({
  from: date.optional().describe("First day; defaults to 29 days before `to`"),
  to: date.optional().describe("Last day, included; defaults to today"),
});

export const REPORT_INTERVALS = ["day", "week"] as const;

export const volumeQuerySchema = reportRangeQuerySchema.extend({
  interval: z
    .enum(REPORT_INTERVALS)
    .default("day")
    .describe("`week` buckets start on Mondays"),
});

const rangeFields = {
  timeZone: z.string().describe("The reporting time zone the days are in"),
  from: z.iso.date(),
  to: z.iso.date(),
};

export const volumeReportSchema = z.object({
  ...rangeFields,
  interval: z.enum(REPORT_INTERVALS),
  total: z.int(),
  buckets: z
    .array(z.object({ start: z.iso.date(), count: z.int() }))
    .describe("Every day or week in the range, empty ones included"),
});

const durationsSchema = z.object({
  ticketCount: z.int().describe("Tickets the averages are taken over"),
  meanSeconds: z.number().nullable().describe("Null when there are none"),
  medianSeconds: z
    .number()
    .nullable()
    .describe("Shown beside the mean, which a few slow tickets can drag"),
});

export const responseTimesReportSchema = z.object({
  ...rangeFields,
  firstResponse: durationsSchema
    .extend({
      awaitingFirstResponse: z
        .int()
        .describe(
          "Tickets created in the range, not closed, with no reply yet: they can't be in the average, so they are counted here",
        ),
    })
    .describe("Tickets created in the range that have had a first reply"),
  resolution: durationsSchema.describe(
    "Tickets whose latest resolution falls in the range",
  ),
});

export const agentsReportSchema = z.object({
  ...rangeFields,
  agents: z.array(
    z.object({
      agent: z.object({
        id: z.uuid(),
        displayName: z.string(),
        role: agentRoleSchema,
        active: z.boolean(),
      }),
      openAssigned: z
        .int()
        .describe("`open` and `pending_customer` tickets they hold now"),
      resolvedInRange: z
        .int()
        .describe(
          "Tickets they hold whose latest resolution falls in the range",
        ),
    }),
  ),
});

export type ReportRangeQuery = z.infer<typeof reportRangeQuerySchema>;
export type VolumeQuery = z.infer<typeof volumeQuerySchema>;
export type VolumeReport = z.infer<typeof volumeReportSchema>;
export type ResponseTimesReport = z.infer<typeof responseTimesReportSchema>;
export type AgentsReport = z.infer<typeof agentsReportSchema>;
