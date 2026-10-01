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
} from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import {
  cannedRenderQuerySchema,
  cannedResponseCreateRequestSchema,
  cannedResponseListQuerySchema,
  cannedResponseSchema,
  cannedResponseUpdateRequestSchema,
  pageOf,
  renderedCannedResponseSchema,
} from "@dsd/shared";
import type { FastifyRequest } from "fastify";
import { createZodDto, ZodResponse } from "nestjs-zod";
import { z } from "zod";

import { Realm, RequirePermissions } from "../../auth/decorators.js";
import { staffOf } from "../../auth/request-context.js";
import { ApiProblem, ApiSession } from "../../openapi/decorators.js";
import { CannedResponsesService } from "./canned-responses.service.js";

class TemplateParams extends createZodDto(
  z.strictObject({ cannedResponseId: z.uuid() }),
) {}
class ListQuery extends createZodDto(cannedResponseListQuerySchema) {}
class RenderQuery extends createZodDto(cannedRenderQuerySchema) {}
class Template extends createZodDto(cannedResponseSchema) {}
class TemplatePage extends createZodDto(pageOf(cannedResponseSchema)) {}
class TemplateCreate extends createZodDto(cannedResponseCreateRequestSchema) {}
class TemplateUpdate extends createZodDto(cannedResponseUpdateRequestSchema) {}
class Rendered extends createZodDto(renderedCannedResponseSchema) {}

/**
 * Canned responses (FR-12). Using them needs `canned:use`; writing and
 * retiring them, `canned:manage`. Templates outside your brands are a 404.
 */
@ApiTags("Canned responses")
@Realm("staff")
@Controller("staff/canned-responses")
export class CannedResponsesController {
  constructor(private readonly templates: CannedResponsesService) {}

  @Get()
  @RequirePermissions("canned:use")
  @ApiSession("staff", { changesState: false })
  @ApiOperation({
    summary: "List templates",
    description: "Active templates by title; `includeRetired` adds the rest.",
  })
  @ApiProblem(400, "A filter or the cursor is invalid")
  @ApiProblem(403, "Missing the `canned:use` permission")
  @ZodResponse({ status: HttpStatus.OK, type: TemplatePage })
  list(@Query() query: ListQuery, @Req() request: FastifyRequest) {
    return this.templates.list(staffOf(request), query);
  }

  @Get(":cannedResponseId/render")
  @RequirePermissions("canned:use")
  @ApiSession("staff", { changesState: false })
  @ApiOperation({
    summary: "Fill a template in for a ticket",
    description:
      "Plain text with every variable filled from the ticket as it is now. Put it in the composer, edit it, then send it as a reply: nothing is sent from here.",
  })
  @ApiProblem(400, "`ticketId` is missing or invalid")
  @ApiProblem(403, "Missing the `canned:use` permission")
  @ApiProblem(404, "No such active template or ticket in your brands")
  @ApiProblem(422, "The template belongs to another brand than the ticket")
  @ZodResponse({ status: HttpStatus.OK, type: Rendered })
  render(
    @Param() params: TemplateParams,
    @Query() query: RenderQuery,
    @Req() request: FastifyRequest,
  ) {
    return this.templates.render(
      staffOf(request),
      params.cannedResponseId,
      query.ticketId,
    );
  }

  @Post()
  @RequirePermissions("canned:manage")
  @HttpCode(HttpStatus.CREATED)
  @ApiSession("staff", { changesState: true })
  @ApiOperation({
    summary: "Add a template",
    description: "A placeholder that isn't a known variable is a 400.",
  })
  @ApiProblem(400, "The body is invalid, or uses an unknown variable")
  @ApiProblem(403, "Missing the `canned:manage` permission")
  @ApiProblem(404, "The brand isn't one of yours")
  @ApiProblem(409, "An active template has that title (`already-exists`)")
  @ZodResponse({ status: HttpStatus.CREATED, type: Template })
  create(@Body() body: TemplateCreate, @Req() request: FastifyRequest) {
    return this.templates.create(staffOf(request), body);
  }

  @Patch(":cannedResponseId")
  @RequirePermissions("canned:manage")
  @ApiSession("staff", { changesState: true })
  @ApiOperation({ summary: "Edit a template" })
  @ApiProblem(400, "The body is invalid, or uses an unknown variable")
  @ApiProblem(403, "Missing the `canned:manage` permission")
  @ApiProblem(404, "No such template in your brands")
  @ApiProblem(409, "An active template has that title (`already-exists`)")
  @ZodResponse({ status: HttpStatus.OK, type: Template })
  update(
    @Param() params: TemplateParams,
    @Body() body: TemplateUpdate,
    @Req() request: FastifyRequest,
  ) {
    return this.templates.update(
      staffOf(request),
      params.cannedResponseId,
      body,
    );
  }

  @Post(":cannedResponseId/retire")
  @RequirePermissions("canned:manage")
  @HttpCode(HttpStatus.OK)
  @ApiSession("staff", { changesState: true })
  @ApiOperation({
    summary: "Retire a template",
    description:
      "Hides it from the composer without deleting it. Its title is free for a new template.",
  })
  @ApiProblem(403, "Missing the `canned:manage` permission")
  @ApiProblem(404, "No such template in your brands")
  @ZodResponse({ status: HttpStatus.OK, type: Template })
  retire(@Param() params: TemplateParams, @Req() request: FastifyRequest) {
    return this.templates.retire(staffOf(request), params.cannedResponseId);
  }
}
