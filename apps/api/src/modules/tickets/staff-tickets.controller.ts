import { Controller, Get, HttpStatus, Param, Query, Req } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import {
  pageOf,
  queueQuerySchema,
  staffTicketSchema,
  staffTicketSummarySchema,
} from "@dsd/shared";
import type { FastifyRequest } from "fastify";
import { createZodDto, ZodResponse } from "nestjs-zod";

import { Realm, RequirePermissions } from "../../auth/decorators.js";
import { staffOf } from "../../auth/request-context.js";
import { ApiProblem, ApiSession } from "../../openapi/decorators.js";
import { TicketParams } from "./params.js";
import { TicketQueriesService } from "./ticket-queries.service.js";

class QueueQuery extends createZodDto(queueQuerySchema) {}
class StaffTicketPage extends createZodDto(pageOf(staffTicketSummarySchema)) {}
class StaffTicket extends createZodDto(staffTicketSchema) {}

/**
 * Working tickets (FR-7 to FR-11). Every route needs a staff session and a
 * permission, and every query is limited to the agent's brands, so a ticket
 * outside them is a 404 like a missing one.
 */
@ApiTags("Tickets (staff)")
@Realm("staff")
@Controller("staff/tickets")
export class StaffTicketsController {
  constructor(private readonly queries: TicketQueriesService) {}

  @Get()
  @RequirePermissions("ticket:read:any")
  @ApiSession("staff", { changesState: false })
  @ApiOperation({
    summary: "The queue",
    description:
      "Tickets from every channel, filtered by status (default `open`), priority, assignee and escalation, and sorted by priority then age, or by age alone. A page at a time.",
  })
  @ApiProblem(400, "A filter or the cursor is invalid")
  @ApiProblem(403, "Missing the `ticket:read:any` permission")
  @ZodResponse({ status: HttpStatus.OK, type: StaffTicketPage })
  queue(@Query() query: QueueQuery, @Req() request: FastifyRequest) {
    return this.queries.queue(staffOf(request), query);
  }

  @Get(":ticketId")
  @RequirePermissions("ticket:read:any")
  @ApiSession("staff", { changesState: false })
  @ApiOperation({
    summary: "One ticket",
    description:
      "The whole thread, internal notes included, every file, the customer, and `allowedTransitions` and `allowedActions` for you: the agent app shows controls from these and the API enforces the same rules.",
  })
  @ApiProblem(403, "Missing the `ticket:read:any` permission")
  @ApiProblem(404, "No such ticket in your brands")
  @ZodResponse({ status: HttpStatus.OK, type: StaffTicket })
  view(@Param() params: TicketParams, @Req() request: FastifyRequest) {
    return this.queries.staffTicket(staffOf(request), params.ticketId);
  }
}
