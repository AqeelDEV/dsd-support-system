import {
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
} from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { guestTicketFieldsSchema, guestTicketReceiptSchema } from "@dsd/shared";
import type { FastifyReply, FastifyRequest } from "fastify";
import { createZodDto, ZodResponse } from "nestjs-zod";

import { Public } from "../../auth/decorators.js";
import { RateLimit } from "../../auth/guards/rate-limit.guard.js";
import { RATE_LIMITS } from "../../auth/rate-limit/policies.js";
import { ApiMultipartBody, ApiProblem } from "../../openapi/decorators.js";
import { withSubmission } from "../attachments/multipart.js";
import { TicketSubmissionService } from "./ticket-submission.service.js";

class GuestTicketReceipt extends createZodDto(guestTicketReceiptSchema) {}

/** The support form for people without an account (FR-1, FR-2). */
@ApiTags("Tickets (public)")
@Public()
@Controller("public/tickets")
export class PublicTicketsController {
  constructor(private readonly submission: TicketSubmissionService) {}

  @Post()
  @RateLimit(RATE_LIMITS.ticketSubmission)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: "Raise a ticket as a guest",
    description:
      "Takes an email, a subject, a description and up to five files. It answers with the ticket reference and doesn't sign anyone in: the thread opens from the link emailed to that address, so only its owner can read the replies. Limited to 10 an hour per address and 5 an hour per email; it stays open if the rate-limit store is down.",
  })
  @ApiMultipartBody(guestTicketFieldsSchema)
  @ApiProblem(400, "A field is missing or invalid (`validation-error`)")
  @ApiProblem(403, "Not sent from a trusted origin (`csrf-rejected`)")
  @ApiProblem(429, "Too many tickets; `Retry-After` says when to try again")
  @ZodResponse({ status: HttpStatus.CREATED, type: GuestTicketReceipt })
  submit(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    return withSubmission(request, reply, guestTicketFieldsSchema, (form) =>
      this.submission.submitAsGuest(form, request.id),
    );
  }
}
