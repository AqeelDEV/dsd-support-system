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
  agentInviteRequestSchema,
  agentListQuerySchema,
  agentRoleChangeRequestSchema,
  agentSchema,
  agentUpdateRequestSchema,
  assignableAgentsSchema,
  pageOf,
} from "@dsd/shared";
import type { FastifyRequest } from "fastify";
import { createZodDto, ZodResponse } from "nestjs-zod";
import { z } from "zod";

import { Realm, RequirePermissions } from "../../auth/decorators.js";
import { staffOf } from "../../auth/request-context.js";
import { ApiProblem, ApiSession } from "../../openapi/decorators.js";
import { AgentsService } from "./agents.service.js";

class AgentParams extends createZodDto(z.strictObject({ agentId: z.uuid() })) {}
class AgentListQuery extends createZodDto(agentListQuerySchema) {}
class AgentPage extends createZodDto(pageOf(agentSchema)) {}
class AgentView extends createZodDto(agentSchema) {}
class AgentInvite extends createZodDto(agentInviteRequestSchema) {}
class AgentUpdate extends createZodDto(agentUpdateRequestSchema) {}
class AgentRoleChange extends createZodDto(agentRoleChangeRequestSchema) {}
class AssignableAgents extends createZodDto(assignableAgentsSchema) {}

const RANK_RULES =
  "Supervisors manage agents; admins manage everyone else. Nobody manages their own account, and no change may leave the system without an active admin.";

/**
 * Agent accounts and roles (FR-14). Reading needs `user:read`; every change
 * needs `user:manage` and passes the rank rules (ADR-0004, section 4).
 * Colleagues outside your brands are a 404.
 */
@ApiTags("Agents")
@Realm("staff")
@Controller("staff/agents")
export class AgentsController {
  constructor(private readonly agents: AgentsService) {}

  @Get()
  @RequirePermissions("user:read")
  @ApiSession("staff", { changesState: false })
  @ApiOperation({
    summary: "List colleagues",
    description:
      "Staff who share a brand with you, by name, with what you may do to each (`allowedActions`, `grantableRoles`).",
  })
  @ApiProblem(400, "A filter or the cursor is invalid")
  @ApiProblem(403, "Missing the `user:read` permission")
  @ZodResponse({ status: HttpStatus.OK, type: AgentPage })
  list(@Query() query: AgentListQuery, @Req() request: FastifyRequest) {
    return this.agents.list(staffOf(request), query);
  }

  @Get("assignable")
  @RequirePermissions("ticket:assign")
  @ApiSession("staff", { changesState: false })
  @ApiOperation({
    summary: "Colleagues a ticket can go to",
    description:
      "Active staff who share a brand with you, you included, with name and role only. For the agent app's assign and escalate pickers; it needs `ticket:assign`, not `user:read`. Assigning still checks the colleague against the ticket's brand.",
  })
  @ApiProblem(403, "Missing the `ticket:assign` permission")
  @ZodResponse({ status: HttpStatus.OK, type: AssignableAgents })
  assignable(@Req() request: FastifyRequest) {
    return this.agents.assignable(staffOf(request));
  }

  @Get(":agentId")
  @RequirePermissions("user:read")
  @ApiSession("staff", { changesState: false })
  @ApiOperation({ summary: "One colleague" })
  @ApiProblem(403, "Missing the `user:read` permission")
  @ApiProblem(404, "No such agent in your brands")
  @ZodResponse({ status: HttpStatus.OK, type: AgentView })
  view(@Param() params: AgentParams, @Req() request: FastifyRequest) {
    return this.agents.get(staffOf(request), params.agentId);
  }

  @Post()
  @RequirePermissions("user:manage")
  @HttpCode(HttpStatus.CREATED)
  @ApiSession("staff", { changesState: true })
  @ApiOperation({
    summary: "Invite an agent",
    description:
      "Creates the account without a password, in your brands, and emails an invite link that is valid for 72 hours. You can give any role up to your own.",
  })
  @ApiProblem(400, "The body is invalid (`validation-error`)")
  @ApiProblem(403, "Missing `user:manage`, or the role is above your own")
  @ApiProblem(409, "A staff account with that email exists (`already-exists`)")
  @ZodResponse({ status: HttpStatus.CREATED, type: AgentView })
  invite(@Body() body: AgentInvite, @Req() request: FastifyRequest) {
    return this.agents.invite(staffOf(request), body, request.id);
  }

  @Patch(":agentId")
  @RequirePermissions("user:manage")
  @ApiSession("staff", { changesState: true })
  @ApiOperation({ summary: "Rename a colleague", description: RANK_RULES })
  @ApiProblem(400, "The body is invalid (`validation-error`)")
  @ApiProblem(403, "Missing `user:manage`, or the rank rules forbid it")
  @ApiProblem(404, "No such agent in your brands")
  @ZodResponse({ status: HttpStatus.OK, type: AgentView })
  update(
    @Param() params: AgentParams,
    @Body() body: AgentUpdate,
    @Req() request: FastifyRequest,
  ) {
    return this.agents.update(staffOf(request), params.agentId, body);
  }

  @Patch(":agentId/role")
  @RequirePermissions("user:manage")
  @ApiSession("staff", { changesState: true })
  @ApiOperation({
    summary: "Change a colleague's role",
    description: `${RANK_RULES} The colleague is signed out everywhere, so the new role applies at once.`,
  })
  @ApiProblem(400, "Not a role (`validation-error`)")
  @ApiProblem(403, "Missing `user:manage`, or the rank rules forbid it")
  @ApiProblem(404, "No such agent in your brands")
  @ApiProblem(409, "They are the last active admin (`last-admin`)")
  @ZodResponse({ status: HttpStatus.OK, type: AgentView })
  changeRole(
    @Param() params: AgentParams,
    @Body() body: AgentRoleChange,
    @Req() request: FastifyRequest,
  ) {
    return this.agents.changeRole(
      staffOf(request),
      params.agentId,
      body,
      request.id,
    );
  }

  @Post(":agentId/deactivate")
  @RequirePermissions("user:manage")
  @HttpCode(HttpStatus.OK)
  @ApiSession("staff", { changesState: true })
  @ApiOperation({
    summary: "Deactivate a colleague",
    description: `${RANK_RULES} They are signed out everywhere, can't sign in again, and their open and pending tickets go back to the queue.`,
  })
  @ApiProblem(403, "Missing `user:manage`, or the rank rules forbid it")
  @ApiProblem(404, "No such agent in your brands")
  @ApiProblem(409, "They are the last active admin (`last-admin`)")
  @ZodResponse({ status: HttpStatus.OK, type: AgentView })
  deactivate(@Param() params: AgentParams, @Req() request: FastifyRequest) {
    return this.agents.deactivate(staffOf(request), params.agentId, request.id);
  }

  @Post(":agentId/reactivate")
  @RequirePermissions("user:manage")
  @HttpCode(HttpStatus.OK)
  @ApiSession("staff", { changesState: true })
  @ApiOperation({
    summary: "Reactivate a colleague",
    description: `${RANK_RULES} Tickets unassigned when they were deactivated stay in the queue.`,
  })
  @ApiProblem(403, "Missing `user:manage`, or the rank rules forbid it")
  @ApiProblem(404, "No such agent in your brands")
  @ZodResponse({ status: HttpStatus.OK, type: AgentView })
  reactivate(@Param() params: AgentParams, @Req() request: FastifyRequest) {
    return this.agents.reactivate(staffOf(request), params.agentId, request.id);
  }

  @Post(":agentId/invite")
  @RequirePermissions("user:manage")
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiSession("staff", { changesState: true })
  @ApiOperation({
    summary: "Send the invite again",
    description:
      "For an active colleague who hasn't set a password yet, for example because the first link expired.",
  })
  @ApiProblem(403, "Missing `user:manage`, or the rank rules forbid it")
  @ApiProblem(404, "No such agent in your brands")
  @ApiProblem(409, "They already have a password, or are deactivated")
  @ZodResponse({ status: HttpStatus.ACCEPTED, type: AgentView })
  resendInvite(@Param() params: AgentParams, @Req() request: FastifyRequest) {
    return this.agents.resendInvite(staffOf(request), params.agentId);
  }
}
