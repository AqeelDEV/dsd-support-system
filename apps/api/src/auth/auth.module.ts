import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";

import { SessionCookies } from "./cookies.js";
import { AuthGuard } from "./guards/auth.guard.js";
import { PasswordHasher } from "./password-hasher.js";
import { SessionRepository } from "./sessions/session.repository.js";
import { SessionService } from "./sessions/session.service.js";

/**
 * Realms, sessions and passwords (ADR-0003), and the global guards that
 * enforce them on every route. Global guards run in the order listed.
 */
@Module({
  providers: [
    PasswordHasher,
    SessionRepository,
    SessionService,
    SessionCookies,
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
  exports: [PasswordHasher, SessionService, SessionCookies],
})
export class AuthModule {}
