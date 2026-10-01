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
import { customerMeSchema, loginRequestSchema } from "@dsd/shared";
import type { FastifyReply, FastifyRequest } from "fastify";
import { createZodDto, ZodResponse } from "nestjs-zod";

import { SessionCookies } from "./cookies.js";
import { CsrfTokens } from "./csrf.js";
import { Public, Realm } from "./decorators.js";
import { RateLimit } from "./guards/rate-limit.guard.js";
import { customerMe } from "./me.js";
import { RATE_LIMITS } from "./rate-limit/policies.js";
import { clientOf, customerOf } from "./request-context.js";
import { SessionService } from "./sessions/session.service.js";
import { SignInService } from "./sign-in.service.js";

class LoginBody extends createZodDto(loginRequestSchema) {}
class CustomerMe extends createZodDto(customerMeSchema) {}

/** Customer sign-in (ADR-0003). Staff sessions are never accepted here. */
@ApiTags("Customer sign-in")
@Realm("customer")
@Controller("auth/customer")
export class CustomerAuthController {
  constructor(
    private readonly signIn: SignInService,
    private readonly sessions: SessionService,
    private readonly cookies: SessionCookies,
    private readonly csrf: CsrfTokens,
  ) {}

  @Post("login")
  @Public()
  @RateLimit(RATE_LIMITS.customerLogin)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "Sign in with email and password",
    description:
      "Starts a new customer session in an HttpOnly cookie and returns the same body as `me`. A wrong password, an unknown email and a guest without a password all get the same 401.",
  })
  @ZodResponse({ status: HttpStatus.OK, type: CustomerMe })
  async login(
    @Body() body: LoginBody,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const { session, principal } = await this.signIn.customer(
      body,
      clientOf(request),
      this.cookies.sessionToken(request, "customer"),
    );
    const csrfToken = this.csrf.tokenFor(session.id);
    this.cookies.issue(reply, "customer", session, csrfToken);
    return customerMe(principal, csrfToken);
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
    await this.sessions.revoke(customerOf(request).sessionId);
    this.cookies.clear(reply, "customer");
  }

  @Get("me")
  @ApiOperation({
    summary: "The signed-in customer",
    description:
      "For a guest session, `guestTicketId` names the one ticket it can see.",
  })
  @ZodResponse({ status: HttpStatus.OK, type: CustomerMe })
  me(@Req() request: FastifyRequest) {
    const principal = customerOf(request);
    return customerMe(principal, this.csrf.tokenFor(principal.sessionId));
  }
}
