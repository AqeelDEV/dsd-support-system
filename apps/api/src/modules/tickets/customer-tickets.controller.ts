import {
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
} from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import {
  customerTicketFieldsSchema,
  customerTicketSummarySchema,
} from "@dsd/shared";
import type { FastifyReply, FastifyRequest } from "fastify";
import { createZodDto, ZodResponse } from "nestjs-zod";

import { Realm } from "../../auth/decorators.js";
import { RateLimit } from "../../auth/guards/rate-limit.guard.js";
import { RATE_LIMITS } from "../../auth/rate-limit/policies.js";
import { customerOf } from "../../auth/request-context.js";
import {
  ApiMultipartBody,
  ApiProblem,
  ApiSession,
} from "../../openapi/decorators.js";
import { withSubmission } from "../attachments/multipart.js";
import { TicketSubmissionService } from "./ticket-submission.service.js";

class CustomerTicketSummary extends createZodDto(customerTicketSummarySchema) {}

/**
 * A customer's own tickets (FR-1 to FR-3). Every query filters on the
 * session's customer, and a guest session on its one ticket, so another
 * customer's ticket simply isn't found (404).
 */
@ApiTags("Tickets (customer)")
@Realm("customer")
@Controller("customer/tickets")
export class CustomerTicketsController {
  constructor(private readonly submission: TicketSubmissionService) {}

  @Post()
  @RateLimit(RATE_LIMITS.ticketSubmission)
  @HttpCode(HttpStatus.CREATED)
  @ApiSession("customer", { changesState: true })
  @ApiOperation({
    summary: "Raise a ticket",
    description:
      "For a signed-in customer: the account's email is the contact. A guest session (from an emailed link) can't raise tickets here and gets 403; it uses the public form instead. Limited like the public form.",
  })
  @ApiMultipartBody(customerTicketFieldsSchema)
  @ApiProblem(400, "A field is missing or invalid (`validation-error`)")
  @ApiProblem(
    403,
    "A guest session, or the Origin or CSRF token was wrong (`csrf-rejected`)",
  )
  @ApiProblem(429, "Too many tickets; `Retry-After` says when to try again")
  @ZodResponse({ status: HttpStatus.CREATED, type: CustomerTicketSummary })
  submit(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    return withSubmission(request, reply, customerTicketFieldsSchema, (form) =>
      this.submission.submitAsCustomer(customerOf(request), form, request.id),
    );
  }
}
