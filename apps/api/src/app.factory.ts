import { NestFactory } from "@nestjs/core";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { Logger } from "nestjs-pino";

import { AppModule, type AppModuleOptions } from "./app.module.js";
import { assignRequestId, REQUEST_ID_HEADER } from "./common/request-id.js";
import type { Env } from "./config/env.js";

/**
 * Builds the whole HTTP application: the server, its logging and the
 * routes. `main.ts` and the integration tests both use this, so tests
 * exercise the real pipeline.
 */
export async function createApp(
  env: Env,
  options: AppModuleOptions = {},
): Promise<NestFastifyApplication> {
  const adapter = new FastifyAdapter({
    trustProxy: env.TRUST_PROXY.length > 0 ? env.TRUST_PROXY : false,
    genReqId: assignRequestId,
    // JSON bodies are small. File uploads get their own limits (ADR-0009).
    bodyLimit: 1024 * 1024,
  });

  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule.forRoot(env, options),
    adapter,
    { bufferLogs: true },
  );
  app.useLogger(app.get(Logger));
  app.enableShutdownHooks();

  const fastify = app.getHttpAdapter().getInstance();
  fastify.addHook("onRequest", (request, reply, done) => {
    void reply.header(REQUEST_ID_HEADER, request.id);
    done();
  });

  return app;
}
