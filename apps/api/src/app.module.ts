import { type DynamicModule, Module } from "@nestjs/common";
import { APP_FILTER, APP_INTERCEPTOR, APP_PIPE } from "@nestjs/core";
import { createZodValidationPipe, ZodSerializerInterceptor } from "nestjs-zod";
import type { DestinationStream } from "pino";

import { AuthModule } from "./auth/auth.module.js";
import { loggingModule } from "./common/logging.js";
import { ProblemDetailsFilter } from "./common/problem-details.js";
import type { Env } from "./config/env.js";
import { InfrastructureModule } from "./infrastructure/infrastructure.module.js";
import { AgentsModule } from "./modules/agents/agents.module.js";
import { CannedResponsesModule } from "./modules/canned-responses/canned-responses.module.js";
import { HealthModule } from "./modules/health/health.module.js";
import { KbModule } from "./modules/kb/kb.module.js";
import { TicketsModule } from "./modules/tickets/tickets.module.js";

/**
 * Validates every body, query and path parameter against its zod schema.
 * `strictSchemaDeclaration` makes an endpoint that forgets to declare a
 * schema fail loudly instead of accepting unvalidated input.
 */
const ValidationPipe = createZodValidationPipe({
  strictSchemaDeclaration: true,
});

export interface AppModuleOptions {
  /** Where logs go. Tests pass a stream to inspect them; the default is stdout. */
  logDestination?: DestinationStream;
}

@Module({})
export class AppModule {
  static forRoot(env: Env, options: AppModuleOptions = {}): DynamicModule {
    return {
      module: AppModule,
      imports: [
        loggingModule(env, options.logDestination),
        InfrastructureModule.forRoot(env),
        AuthModule,
        HealthModule,
        TicketsModule,
        AgentsModule,
        KbModule,
        CannedResponsesModule,
      ],
      providers: [
        { provide: APP_PIPE, useClass: ValidationPipe },
        { provide: APP_INTERCEPTOR, useClass: ZodSerializerInterceptor },
        { provide: APP_FILTER, useClass: ProblemDetailsFilter },
      ],
    };
  }
}
