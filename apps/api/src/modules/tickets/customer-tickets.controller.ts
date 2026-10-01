import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
  Res,
} from "@nestjs/common";
import { ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import {
  customerReplyFieldsSchema,
  customerTicketFieldsSchema,
  customerTicketSchema,
  customerTicketSummarySchema,
  pageOf,
  pageQuerySchema,
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
import { sendDownload } from "../attachments/download.js";
import { withSubmission } from "../attachments/multipart.js";
import { AttachmentParams, TicketParams } from "./params.js";
import { TicketMessagesService } from "./ticket-messages.service.js";
import { TicketQueriesService } from "./ticket-queries.service.js";
import { TicketSubmissionService } from "./ticket-submission.service.js";

class CustomerTicketSummary extends createZodDto(customerTicketSummarySchema) {}
class CustomerTicketPage extends createZodDto(
  pageOf(customerTicketSummarySchema),
) {}
class CustomerTicket extends createZodDto(customerTicketSchema) {}
class PageQuery extends createZodDto(pageQuerySchema) {}

/**
 * A customer's own tickets (FR-1 to FR-3). Every query filters on the
 * session's customer, and a guest session on its one ticket, so another
 * customer's ticket simply isn't found (404).
 */
@ApiTags("Tickets (customer)")
@Realm("customer")
@Controller("customer/tickets")
export class CustomerTicketsController {
  constructor(
    private readonly submission: TicketSubmissionService,
    private readonly queries: TicketQueriesService,
    private readonly messages: TicketMessagesService,
  ) {}

  @Get()
  @ApiSession("customer", { changesState: false })
  @ApiOperation({
    summary: "My tickets",
    description:
      "Newest first, a page at a time. A guest session sees only the ticket its link opened.",
  })
  @ApiProblem(400, "A query parameter or the cursor is invalid")
  @ZodResponse({ status: HttpStatus.OK, type: CustomerTicketPage })
  list(@Query() query: PageQuery, @Req() request: FastifyRequest) {
    return this.queries.customerTickets(customerOf(request), query);
  }

  @Get(":ticketId")
  @ApiSession("customer", { changesState: false })
  @ApiOperation({
    summary: "One of my tickets",
    description:
      "The status, the description, every public reply with its files, and the status timeline. Another customer's ticket is a 404, the same as one that doesn't exist.",
  })
  @ApiProblem(404, "No such ticket, or not yours")
  @ZodResponse({ status: HttpStatus.OK, type: CustomerTicket })
  view(@Param() params: TicketParams, @Req() request: FastifyRequest) {
    return this.queries.customerTicket(customerOf(request), params.ticketId);
  }

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
  @ApiProblem(403, "A guest session can't raise tickets here")
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

  @Post(":ticketId/messages")
  @HttpCode(HttpStatus.CREATED)
  @ApiSession("customer", { changesState: true })
  @ApiOperation({
    summary: "Reply to one of my tickets",
    description:
      "Adds a public reply with up to five files. A ticket waiting on the customer, or resolved, reopens. A closed ticket refuses replies with 409 (`ticket-closed`): raise a new ticket instead. Answers with the ticket as it now stands.",
  })
  @ApiMultipartBody(customerReplyFieldsSchema)
  @ApiProblem(400, "The body is missing or invalid (`validation-error`)")
  @ApiProblem(404, "No such ticket, or not yours")
  @ApiProblem(409, "The ticket is closed (`ticket-closed`)")
  @ZodResponse({ status: HttpStatus.CREATED, type: CustomerTicket })
  reply(
    @Param() params: TicketParams,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    return withSubmission(request, reply, customerReplyFieldsSchema, (form) =>
      this.messages.customerReply(
        customerOf(request),
        params.ticketId,
        form,
        request.id,
      ),
    );
  }

  @Get(":ticketId/attachments/:attachmentId")
  @ApiSession("customer", { changesState: false })
  @ApiOperation({
    summary: "Download a file from one of my tickets",
    description:
      "Always a download, never displayed: `Content-Disposition: attachment`, the type detected at upload, `nosniff` and a sandboxing CSP. A file on another customer's ticket is a 404.",
  })
  @ApiOkResponse({
    description: "The file",
    content: {
      "application/octet-stream": {
        schema: { type: "string", format: "binary" },
      },
    },
  })
  @ApiProblem(404, "No such file, or not yours")
  @ApiProblem(503, "File storage is unavailable for a moment")
  async download(
    @Param() params: AttachmentParams,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    return sendDownload(
      reply,
      await this.queries.customerAttachment(
        customerOf(request),
        params.ticketId,
        params.attachmentId,
      ),
    );
  }
}
