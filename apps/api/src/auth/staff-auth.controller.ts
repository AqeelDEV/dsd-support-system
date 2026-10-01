import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
} from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { loginRequestSchema, staffMeSchema } from "@dsd/shared";
import type { FastifyReply, FastifyRequest } from "fastify";
import { createZodDto, ZodResponse } from "nestjs-zod";

import { SessionCookies } from "./cookies.js";
import { CsrfTokens } from "./csrf.js";
import { Public, Realm } from "./decorators.js";
import { RateLimit } from "./guards/rate-limit.guard.js";
import { staffMe } from "./me.js";
import { RATE_LIMITS } from "./rate-limit/policies.js";
import { clientOf, staffOf } from "./request-context.js";
import { SessionService } from "./sessions/session.service.js";
import { SignInService } from "./sign-in.service.js";

class LoginBody extends createZodDto(loginRequestSchema) {}
class StaffMe extends createZodDto(staffMeSchema) {}

/** Staff sign-in (ADR-0003). Customer sessions are never accepted here. */
@ApiTags("Staff sign-in")
@Realm("staff")
@Controller("auth/staff")
export class StaffAuthController {
  constructor(
    private readonly signIn: SignInService,
    private readonly sessions: SessionService,
    private readonly cookies: SessionCookies,
    private readonly csrf: CsrfTokens,
  ) {}

  @Post("login")
  @Public()
  @RateLimit(RATE_LIMITS.staffLogin)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "Sign in with email and password",
    description:
      "Starts a new staff session in an HttpOnly cookie and returns the same body as `me`. A deactivated agent, or one who hasn't accepted their invite, gets the same 401 as a wrong password.",
  })
  @ZodResponse({ status: HttpStatus.OK, type: StaffMe })
  async login(
    @Body() body: LoginBody,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const { session, principal } = await this.signIn.staff(
      body,
      clientOf(request),
      this.cookies.sessionToken(request, "staff"),
    );
    const csrfToken = this.csrf.tokenFor(session.id);
    this.cookies.issue(reply, "staff", session, csrfToken);
    return staffMe(principal, csrfToken);
  }

  @Post("logout")
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: "Sign out",
    description: "Revokes this session and clears its cookies.",
  })
  async logout(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<void> {
    await this.sessions.revoke(staffOf(request).sessionId);
    this.cookies.clear(reply, "staff");
  }

  @Get("me")
  @ApiOperation({
    summary: "The signed-in agent, with their role and permissions",
  })
  @ZodResponse({ status: HttpStatus.OK, type: StaffMe })
  me(@Req() request: FastifyRequest) {
    const principal = staffOf(request);
    return staffMe(principal, this.csrf.tokenFor(principal.sessionId));
  }
}
