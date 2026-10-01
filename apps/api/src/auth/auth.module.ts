import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";

import { OutboxModule } from "../modules/outbox/outbox.module.js";
import { AccountsRepository } from "./accounts.repository.js";
import { SessionCookies } from "./cookies.js";
import { CustomerAuthController } from "./customer-auth.controller.js";
import { EmailedLinksRepository } from "./emailed-links.repository.js";
import { EmailedLinksService } from "./emailed-links.service.js";
import { CsrfTokens } from "./csrf.js";
import { AuthGuard } from "./guards/auth.guard.js";
import { CsrfGuard } from "./guards/csrf.guard.js";
import { PermissionsGuard } from "./guards/permissions.guard.js";
import { RateLimitGuard } from "./guards/rate-limit.guard.js";
import { PasswordHasher } from "./password-hasher.js";
import { RateLimitEnforcer } from "./rate-limit/enforcer.js";
import { RateLimiter } from "./rate-limit/rate-limiter.js";
import { SessionRepository } from "./sessions/session.repository.js";
import { SessionService } from "./sessions/session.service.js";
import { SignInService } from "./sign-in.service.js";
import { StaffAuthController } from "./staff-auth.controller.js";

/**
 * Realms, sessions and passwords (ADR-0003), and the global guards that
 * enforce them on every route. Global guards run in the order listed.
 */
@Module({
  imports: [OutboxModule],
  controllers: [CustomerAuthController, StaffAuthController],
  providers: [
    AccountsRepository,
    SignInService,
    EmailedLinksRepository,
    EmailedLinksService,
    PasswordHasher,
    SessionRepository,
    SessionService,
    SessionCookies,
    CsrfTokens,
    RateLimiter,
    RateLimitEnforcer,
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: CsrfGuard },
    { provide: APP_GUARD, useClass: RateLimitGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
  ],
  exports: [
    PasswordHasher,
    SessionService,
    SessionCookies,
    CsrfTokens,
    RateLimitEnforcer,
  ],
})
export class AuthModule {}
