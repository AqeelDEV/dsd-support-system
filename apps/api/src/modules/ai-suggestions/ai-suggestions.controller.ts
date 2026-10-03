import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  Query,
  Req,
} from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import {
  aiSuggestionFeedbackRequestSchema,
  aiSuggestionFeedbackSchema,
  aiSuggestionListQuerySchema,
  aiSuggestionRequestAcceptedSchema,
  aiSuggestionSchema,
  pageOf,
} from "@dsd/shared";
import type { FastifyRequest } from "fastify";
import { createZodDto, ZodResponse } from "nestjs-zod";
import { z } from "zod";

import { Realm, RequirePermissions } from "../../auth/decorators.js";
import { staffOf } from "../../auth/request-context.js";
import { ApiProblem, ApiSession } from "../../openapi/decorators.js";
import { TicketParams } from "../tickets/params.js";
import { AiSuggestionsService } from "./ai-suggestions.service.js";

class SuggestionParams extends createZodDto(
  z.strictObject({ suggestionId: z.uuid() }),
) {}
class ListQuery extends createZodDto(aiSuggestionListQuerySchema) {}
class SuggestionPage extends createZodDto(pageOf(aiSuggestionSchema)) {}
class RequestAccepted extends createZodDto(aiSuggestionRequestAcceptedSchema) {}
class FeedbackRequest extends createZodDto(aiSuggestionFeedbackRequestSchema) {}
class Feedback extends createZodDto(aiSuggestionFeedbackSchema) {}

/**
 * AI reply suggestions for staff (FR-21, FR-22; ADR-0006). These routes
 * exist only in the staff realm, and none of them sends anything to a
 * customer: a draft becomes a reply only when an agent sends it through
 * `POST /staff/tickets/{ticketId}/replies`.
 */
@ApiTags("AI suggestions")
@Realm("staff")
@Controller("staff")
export class AiSuggestionsController {
  constructor(private readonly suggestions: AiSuggestionsService) {}

  @Get("tickets/:ticketId/ai-suggestions")
  @RequirePermissions("ai:suggestion:read")
  @ApiSession("staff", { changesState: false })
  @ApiOperation({
    summary: "A ticket's suggestions",
    description:
      "Newest first. A new ticket or a customer's message gets one automatically a few seconds later. A `ready` suggestion has a plain-text draft and the knowledge-base articles it cites; the other statuses say why there is no draft, and never show the text of one that failed the checks.",
  })
  @ApiProblem(400, "The limit or the cursor is invalid")
  @ApiProblem(403, "Missing the `ai:suggestion:read` permission")
  @ApiProblem(404, "No such ticket in your brands")
  @ZodResponse({ status: HttpStatus.OK, type: SuggestionPage })
  list(
    @Param() params: TicketParams,
    @Query() query: ListQuery,
    @Req() request: FastifyRequest,
  ) {
    return this.suggestions.list(staffOf(request), params.ticketId, query);
  }

  @Post("tickets/:ticketId/ai-suggestions")
  @RequirePermissions("ai:suggestion:request")
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiSession("staff", { changesState: true })
  @ApiOperation({
    summary: "Ask for a fresh suggestion",
    description:
      "Queues a new draft from the ticket as it is now and answers at once. Poll the list until a suggestion created at or after `requestedAt` appears. Limited to 5 per ticket in 10 minutes and 30 per agent an hour.",
  })
  @ApiProblem(403, "Missing the `ai:suggestion:request` permission")
  @ApiProblem(404, "No such ticket in your brands")
  @ApiProblem(409, "The ticket is closed (`ticket-closed`)")
  @ApiProblem(
    429,
    "Too many requests for this ticket or by you (`rate-limited`)",
  )
  @ApiProblem(503, "The rate-limit store is unavailable; try again shortly")
  @ZodResponse({ status: HttpStatus.ACCEPTED, type: RequestAccepted })
  request(@Param() params: TicketParams, @Req() request: FastifyRequest) {
    return this.suggestions.request(staffOf(request), params.ticketId);
  }

  @Put("ai-suggestions/:suggestionId/feedback")
  @RequirePermissions("ai:suggestion:feedback")
  @ApiSession("staff", { changesState: true })
  @ApiOperation({
    summary: "Rate a suggestion",
    description:
      "Thumbs up or down, with an optional comment, on a `ready` suggestion. Rating it again replaces your earlier rating.",
  })
  @ApiProblem(400, "The body is missing or invalid (`validation-error`)")
  @ApiProblem(403, "Missing the `ai:suggestion:feedback` permission")
  @ApiProblem(404, "No such suggestion on a ticket in your brands")
  @ApiProblem(409, "The suggestion isn't `ready`")
  @ZodResponse({ status: HttpStatus.OK, type: Feedback })
  rate(
    @Param() params: SuggestionParams,
    @Body() body: FeedbackRequest,
    @Req() request: FastifyRequest,
  ) {
    return this.suggestions.rate(staffOf(request), params.suggestionId, body);
  }
}
