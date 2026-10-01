import { Module } from "@nestjs/common";

import { PasswordHasher } from "./password-hasher.js";
import { SessionRepository } from "./sessions/session.repository.js";
import { SessionService } from "./sessions/session.service.js";

/** Realms, sessions and passwords (ADR-0003). */
@Module({
  providers: [PasswordHasher, SessionRepository, SessionService],
  exports: [PasswordHasher, SessionService],
})
export class AuthModule {}
