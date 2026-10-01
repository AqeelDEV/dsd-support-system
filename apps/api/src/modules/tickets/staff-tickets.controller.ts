import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
} from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import {
  assignmentRequestSchema,
  escalationRequestSchema,
  internalNoteFieldsSchema,
  pageOf,
  priorityChangeRequestSchema,
  queueQuerySchema,
  staffReplyFieldsSchema,
  staffTicketSchema,
  staffTicketSummarySchema,
  statusChangeRequestSchema,
} from "@dsd/shared";
import type { FastifyReply, FastifyRequest } from "fastify";
import { createZodDto, ZodResponse } from "nestjs-zod";

import { Realm, RequirePermissions } from "../../auth/decorators.js";
import { staffOf } from "../../auth/request-context.js";
import {
  ApiMultipartBody,
  ApiProblem,
  ApiSession,
} from "../../openapi/decorators.js";
import { withSubmission } from "../attachments/multipart.js";
import { TicketParams } from "./params.js";
import { TicketMessagesService } from "./ticket-messages.service.js";
import { TicketQueriesService } from "./ticket-queries.service.js";
import { TicketUpdatesService } from "./ticket-updates.service.js";

class QueueQuery extends createZodDto(queueQuerySchema) {}
class StaffTicketPage extends createZodDto(pageOf(staffTicketSummarySchema)) {}
class StaffTicket extends createZodDto(staffTicketSchema) {}
class StatusChange extends createZodDto(statusChangeRequestSchema) {}
class PriorityChange extends createZodDto(priorityChangeRequestSchema) {}
class Assignment extends createZodDto(assignmentRequestSchema) {}
class Escalation extends createZodDto(escalationRequestSchema) {}

/**
 * Working tickets (FR-7 to FR-11). Every route needs a staff session and a
 * permission, and every query is limited to the agent's brands, so a ticket
 * outside them is a 404 like a missing one.
 */
@ApiTags("Tickets (staff)")
@Realm("staff")
@Controller("staff/tickets")
export class StaffTicketsController {
  constructor(
    private readonly queries: TicketQueriesService,
    private readonly messages: TicketMessagesService,
    private readonly updates: TicketUpdatesService,
  ) {}

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

  @Post(":ticketId/replies")
  @RequirePermissions("ticket:reply")
  @HttpCode(HttpStatus.CREATED)
  @ApiSession("staff", { changesState: true })
  @ApiOperation({
    summary: "Reply to the customer",
    description:
      "A public reply with up to five files. `status` moves the ticket in the same transaction, through the state machine, and also needs `ticket:status:update`. The first reply records the first response time. A closed ticket refuses replies. Answers with the ticket as it now stands.",
  })
  @ApiMultipartBody(staffReplyFieldsSchema)
  @ApiProblem(400, "The body is missing or invalid (`validation-error`)")
  @ApiProblem(
    403,
    "Missing `ticket:reply`, or `ticket:status:update` for `status`",
  )
  @ApiProblem(404, "No such ticket in your brands")
  @ApiProblem(
    409,
    "The ticket is closed (`ticket-closed`), or it can't move to that status (`invalid-status-transition`, with `allowedTransitions`)",
  )
  @ZodResponse({ status: HttpStatus.CREATED, type: StaffTicket })
  reply(
    @Param() params: TicketParams,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    return withSubmission(request, reply, staffReplyFieldsSchema, (form) =>
      this.messages.staffReply(
        staffOf(request),
        params.ticketId,
        form,
        request.id,
      ),
    );
  }

  @Post(":ticketId/notes")
  @RequirePermissions("ticket:note:create")
  @HttpCode(HttpStatus.CREATED)
  @ApiSession("staff", { changesState: true })
  @ApiOperation({
    summary: "Add an internal note",
    description:
      "A note with up to five files that only staff ever see: never in a customer response, never in an email. Allowed in every status, closed included.",
  })
  @ApiMultipartBody(internalNoteFieldsSchema)
  @ApiProblem(400, "The body is missing or invalid (`validation-error`)")
  @ApiProblem(403, "Missing the `ticket:note:create` permission")
  @ApiProblem(404, "No such ticket in your brands")
  @ZodResponse({ status: HttpStatus.CREATED, type: StaffTicket })
  addNote(
    @Param() params: TicketParams,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    return withSubmission(request, reply, internalNoteFieldsSchema, (form) =>
      this.messages.addNote(
        staffOf(request),
        params.ticketId,
        form,
        request.id,
      ),
    );
  }

  @Patch(":ticketId/status")
  @RequirePermissions("ticket:status:update")
  @ApiSession("staff", { changesState: true })
  @ApiOperation({
    summary: "Change the status",
    description:
      "Moves the ticket through the state machine (ADR-0007). The current status is a no-op. Anything else not allowed from here is a 409 whose `allowedTransitions` lists where the ticket can go.",
  })
  @ApiProblem(400, "Not a status (`validation-error`)")
  @ApiProblem(403, "Missing the `ticket:status:update` permission")
  @ApiProblem(404, "No such ticket in your brands")
  @ApiProblem(
    409,
    "Not allowed from the current status (`invalid-status-transition`)",
  )
  @ZodResponse({ status: HttpStatus.OK, type: StaffTicket })
  changeStatus(
    @Param() params: TicketParams,
    @Body() body: StatusChange,
    @Req() request: FastifyRequest,
  ) {
    return this.updates.changeStatus(
      staffOf(request),
      params.ticketId,
      body,
      request.id,
    );
  }

  @Patch(":ticketId/priority")
  @RequirePermissions("ticket:priority:update")
  @ApiSession("staff", { changesState: true })
  @ApiOperation({
    summary: "Change the priority",
    description:
      "Customers never choose or see the priority. A closed ticket keeps the one it had.",
  })
  @ApiProblem(400, "Not a priority (`validation-error`)")
  @ApiProblem(403, "Missing the `ticket:priority:update` permission")
  @ApiProblem(404, "No such ticket in your brands")
  @ApiProblem(409, "The ticket is closed (`ticket-closed`)")
  @ZodResponse({ status: HttpStatus.OK, type: StaffTicket })
  changePriority(
    @Param() params: TicketParams,
    @Body() body: PriorityChange,
    @Req() request: FastifyRequest,
  ) {
    return this.updates.changePriority(
      staffOf(request),
      params.ticketId,
      body,
      request.id,
    );
  }

  @Post(":ticketId/assignment")
  @RequirePermissions("ticket:assign")
  @HttpCode(HttpStatus.OK)
  @ApiSession("staff", { changesState: true })
  @ApiOperation({
    summary: "Claim, assign or unassign",
    description:
      "`claim` takes an unassigned ticket, and answers 409 if someone else got there first. `assign` hands the ticket to an active agent in its brand, and `unassign` returns it to the pool. Without `ticket:reassign:any` you may only move tickets that are unassigned or yours.",
  })
  @ApiProblem(400, "Not one of the three actions (`validation-error`)")
  @ApiProblem(
    403,
    "Missing `ticket:assign`, or the ticket is someone else's and you lack `ticket:reassign:any`",
  )
  @ApiProblem(404, "No such ticket in your brands")
  @ApiProblem(
    409,
    "Someone else has it (`already-assigned`), or it is closed (`ticket-closed`)",
  )
  @ApiProblem(
    422,
    "The agent is deactivated, doesn't exist, or isn't in the ticket's brand",
  )
  @ZodResponse({ status: HttpStatus.OK, type: StaffTicket })
  assign(
    @Param() params: TicketParams,
    @Body() body: Assignment,
    @Req() request: FastifyRequest,
  ) {
    return this.updates.assign(
      staffOf(request),
      params.ticketId,
      body,
      request.id,
    );
  }

  @Post(":ticketId/escalate")
  @RequirePermissions("ticket:escalate")
  @HttpCode(HttpStatus.OK)
  @ApiSession("staff", { changesState: true })
  @ApiOperation({
    summary: "Escalate",
    description:
      "Records the reason as an internal note, raises the priority to at least `high`, hands the ticket to `supervisorId` if given, and marks it escalated, all at once. The ticket keeps its status; the queue's `escalated` filter finds it. The customer sees none of it.",
  })
  @ApiProblem(400, "The reason is missing or invalid (`validation-error`)")
  @ApiProblem(403, "Missing the `ticket:escalate` permission")
  @ApiProblem(404, "No such ticket in your brands")
  @ApiProblem(409, "The ticket is closed (`ticket-closed`)")
  @ApiProblem(
    422,
    "`supervisorId` isn't an active supervisor or admin in the ticket's brand",
  )
  @ZodResponse({ status: HttpStatus.OK, type: StaffTicket })
  escalate(
    @Param() params: TicketParams,
    @Body() body: Escalation,
    @Req() request: FastifyRequest,
  ) {
    return this.updates.escalate(
      staffOf(request),
      params.ticketId,
      body,
      request.id,
    );
  }
}
