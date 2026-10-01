import { Controller, Get, HttpStatus, Query, Req } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import {
  agentsReportSchema,
  reportRangeQuerySchema,
  responseTimesReportSchema,
  volumeQuerySchema,
  volumeReportSchema,
} from "@dsd/shared";
import type { FastifyRequest } from "fastify";
import { createZodDto, ZodResponse } from "nestjs-zod";

import { Realm, RequirePermissions } from "../../auth/decorators.js";
import { staffOf } from "../../auth/request-context.js";
import { ApiProblem, ApiSession } from "../../openapi/decorators.js";
import { ReportsService } from "./reports.service.js";

class RangeQuery extends createZodDto(reportRangeQuerySchema) {}
class VolumeQuery extends createZodDto(volumeQuerySchema) {}
class VolumeReport extends createZodDto(volumeReportSchema) {}
class ResponseTimesReport extends createZodDto(responseTimesReportSchema) {}
class AgentsReport extends createZodDto(agentsReportSchema) {}

const RANGE =
  "Whole days in the reporting time zone, `from` and `to` included; the last 30 days by default, at most 366. Calendar time, over your brands.";

/** Team performance (FR-13), for supervisors and admins (`report:view`). */
@ApiTags("Reports")
@Realm("staff")
@Controller("staff/reports")
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get("volume")
  @RequirePermissions("report:view")
  @ApiSession("staff", { changesState: false })
  @ApiOperation({
    summary: "Ticket volume over time",
    description: `Tickets created per day or per week (weeks start on Monday). ${RANGE}`,
  })
  @ApiProblem(
    400,
    "A date is invalid, `from` is after `to`, or the range is too long",
  )
  @ApiProblem(403, "Missing the `report:view` permission")
  @ZodResponse({ status: HttpStatus.OK, type: VolumeReport })
  volume(@Query() query: VolumeQuery, @Req() request: FastifyRequest) {
    return this.reports.volume(staffOf(request), query);
  }

  @Get("response-times")
  @RequirePermissions("report:view")
  @ApiSession("staff", { changesState: false })
  @ApiOperation({
    summary: "Time to first response and to resolution",
    description: `Mean and median, in seconds. First responses cover tickets created in the range, with a count of those still waiting; resolutions cover tickets whose latest resolution is in the range. ${RANGE}`,
  })
  @ApiProblem(
    400,
    "A date is invalid, `from` is after `to`, or the range is too long",
  )
  @ApiProblem(403, "Missing the `report:view` permission")
  @ZodResponse({ status: HttpStatus.OK, type: ResponseTimesReport })
  responseTimes(@Query() query: RangeQuery, @Req() request: FastifyRequest) {
    return this.reports.responseTimes(staffOf(request), query);
  }

  @Get("agents")
  @RequirePermissions("report:view")
  @ApiSession("staff", { changesState: false })
  @ApiOperation({
    summary: "Tickets per agent",
    description: `For each colleague: the open and pending tickets they hold now, and the tickets they hold that were resolved in the range. ${RANGE}`,
  })
  @ApiProblem(
    400,
    "A date is invalid, `from` is after `to`, or the range is too long",
  )
  @ApiProblem(403, "Missing the `report:view` permission")
  @ZodResponse({ status: HttpStatus.OK, type: AgentsReport })
  agents(@Query() query: RangeQuery, @Req() request: FastifyRequest) {
    return this.reports.agents(staffOf(request), query);
  }
}
