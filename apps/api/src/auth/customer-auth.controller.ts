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
import {
  ApiAcceptedResponse,
  ApiNoContentResponse,
  ApiOperation,
  ApiTags,
} from "@nestjs/swagger";
import {
  customerMeSchema,
  guestAccessExchangeRequestSchema,
  guestAccessRequestSchema,
  loginRequestSchema,
  signupCompleteRequestSchema,
  signupRequestSchema,
} from "@dsd/shared";
import type { FastifyReply, FastifyRequest } from "fastify";
import { createZodDto, ZodResponse } from "nestjs-zod";

import {
  ApiPublicForm,
  ApiSession,
  ApiWrongCredentials,
} from "../openapi/decorators.js";

import { SessionCookies } from "./cookies.js";
import { CsrfTokens } from "./csrf.js";
import { Public, Realm } from "./decorators.js";
import { EmailedLinksService } from "./emailed-links.service.js";
import { RateLimit } from "./guards/rate-limit.guard.js";
import { customerMe } from "./me.js";
import { RATE_LIMITS } from "./rate-limit/policies.js";
import { clientOf, customerOf } from "./request-context.js";
import { SessionService } from "./sessions/session.service.js";
import { SignInService } from "./sign-in.service.js";

class LoginBody extends createZodDto(loginRequestSchema) {}
class SignupBody extends createZodDto(signupRequestSchema) {}
class SignupCompleteBody extends createZodDto(signupCompleteRequestSchema) {}
class GuestAccessRequestBody extends createZodDto(guestAccessRequestSchema) {}
class GuestAccessExchangeBody extends createZodDto(
  guestAccessExchangeRequestSchema,
) {}
class CustomerMe extends createZodDto(customerMeSchema) {}

/** Customer sign-in (ADR-0003). Staff sessions are never accepted here. */
@ApiTags("Customer sign-in")
@Realm("customer")
@Controller("auth/customer")
export class CustomerAuthController {
  constructor(
    private readonly signIn: SignInService,
    private readonly links: EmailedLinksService,
    private readonly sessions: SessionService,
    private readonly cookies: SessionCookies,
    private readonly csrf: CsrfTokens,
  ) {}

  @Post("login")
  @Public()
  @RateLimit(RATE_LIMITS.customerLogin)
  @ApiPublicForm()
  @ApiWrongCredentials()
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

  @Post("signup")
  @Public()
  @RateLimit(RATE_LIMITS.signup)
  @ApiPublicForm()
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: "Start registration",
    description:
      "Takes only an email and always answers 202. The address gets a verification link, or a reminder to sign in if it already has an account. The password is chosen after the link proves the inbox is yours, so nobody can set one for someone else's address.",
  })
  @ApiAcceptedResponse({ description: "Check your inbox" })
  async signup(@Body() body: SignupBody): Promise<void> {
    await this.links.requestSignup(body.email);
  }

  @Post("signup/complete")
  @Public()
  @RateLimit(RATE_LIMITS.signupCompletion)
  @ApiPublicForm()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "Finish registration from the emailed link",
    description:
      "Sets the first password and display name, verifies the email and signs in. Tickets raised earlier as a guest with this email are already in the account.",
  })
  @ZodResponse({ status: HttpStatus.OK, type: CustomerMe })
  async completeSignup(
    @Body() body: SignupCompleteBody,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const { session, principal } = await this.links.completeSignup(
      body,
      clientOf(request),
      this.cookies.sessionToken(request, "customer"),
    );
    const csrfToken = this.csrf.tokenFor(session.id);
    this.cookies.issue(reply, "customer", session, csrfToken);
    return customerMe(principal, csrfToken);
  }

  @Post("guest-access/request")
  @Public()
  @RateLimit(RATE_LIMITS.guestLinkRequest)
  @ApiPublicForm()
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: "Ask for a new link to a ticket",
    description:
      "Always answers 202. If the email and ticket reference match, a fresh access link is emailed.",
  })
  @ApiAcceptedResponse({ description: "Check your inbox" })
  async requestGuestLink(@Body() body: GuestAccessRequestBody): Promise<void> {
    await this.links.requestGuestLink(body);
  }

  @Post("guest-access/exchange")
  @Public()
  @RateLimit(RATE_LIMITS.guestLinkExchange)
  @ApiPublicForm()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "Open a ticket from an emailed link",
    description:
      "Exchanges the token from the link's URL fragment for a guest session that can see that one ticket.",
  })
  @ZodResponse({ status: HttpStatus.OK, type: CustomerMe })
  async exchangeGuestLink(
    @Body() body: GuestAccessExchangeBody,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const { session, principal } = await this.links.exchangeGuestLink(
      body.token,
      clientOf(request),
      this.cookies.sessionToken(request, "customer"),
    );
    const csrfToken = this.csrf.tokenFor(session.id);
    this.cookies.issue(reply, "customer", session, csrfToken);
    return customerMe(principal, csrfToken);
  }

  @Post("logout")
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiSession("customer", { changesState: true })
  @ApiNoContentResponse({ description: "Signed out" })
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
  @ApiSession("customer", { changesState: false })
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
