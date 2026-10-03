import cookie from "@fastify/cookie";
import helmet from "@fastify/helmet";
import multipart from "@fastify/multipart";
import { NestFactory } from "@nestjs/core";
import { ATTACHMENT_LIMITS } from "@dsd/shared";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { Logger } from "nestjs-pino";

import { AppModule, type AppModuleOptions } from "./app.module.js";
import { enforceRouteAccess } from "./auth/route-access.js";
import { assignRequestId, REQUEST_ID_HEADER } from "./common/request-id.js";
import type { Env } from "./config/env.js";
import { buildOpenApiDocument, serveApiDocs } from "./openapi/document.js";

export const API_PREFIX = "api/v1";

/** Routes that infrastructure calls, kept outside the versioned prefix. */
export const UNVERSIONED_ROUTES = ["health", "ready"];

/**
 * The longest a request may take to arrive, body included. Fastify turns
 * Node's own limit off unless told otherwise, which lets a client hold a
 * connection open indefinitely by trickling bytes. Five minutes is Node's
 * default, and enough for five 10 MB files on a slow uplink; a reverse proxy
 * in front would usually be stricter still.
 */
export const REQUEST_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * Builds the whole HTTP application: the server, its security headers and
 * error handling, and the routes. `main.ts`, the integration tests and the
 * OpenAPI generator all use this, so tests exercise the real pipeline.
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
    requestTimeout: REQUEST_TIMEOUT_MS,
  });
  // Before anything registers a route, so every route is checked.
  enforceRouteAccess(adapter.getInstance());

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

  await app.register(helmet, {
    // JSON responses need no CSP; these directives exist for Swagger UI,
    // which loads its own scripts and styles from this origin.
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:"],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        baseUri: ["'none'"],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
      },
    },
    xFrameOptions: { action: "deny" },
    strictTransportSecurity:
      env.NODE_ENV === "production"
        ? { maxAge: 31_536_000, includeSubDomains: true }
        : false,
  });

  await app.register(cookie);

  // Only routes that take files read multipart bodies, in their handlers,
  // after the guards have run (ADR-0011). These limits stop busboy itself;
  // the handlers check the rest.
  await app.register(multipart, {
    limits: {
      fileSize: ATTACHMENT_LIMITS.maxBytes,
      files: ATTACHMENT_LIMITS.maxFiles,
      // Room for a 20,000-character message in UTF-8; longer is refused.
      fieldSize: 100 * 1024,
      fields: 10,
      parts: ATTACHMENT_LIMITS.maxFiles + 10,
      headerPairs: 100,
    },
    throwFileSizeLimit: true,
  });

  app.enableCors({
    origin: env.CORS_ORIGINS.length > 0 ? env.CORS_ORIGINS : false,
    credentials: true,
  });

  app.setGlobalPrefix(API_PREFIX, { exclude: UNVERSIONED_ROUTES });
  serveApiDocs(app, buildOpenApiDocument(app, env.COOKIE_SECURE));

  return app;
}
