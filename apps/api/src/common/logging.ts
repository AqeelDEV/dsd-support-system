import type { IncomingMessage, ServerResponse } from "node:http";

import { type DynamicModule } from "@nestjs/common";
import { LoggerModule } from "nestjs-pino";
import type { DestinationStream } from "pino";
import type { Options as PinoHttpOptions } from "pino-http";

import type { Env } from "../config/env.js";
import { requestPath } from "./url.js";

/**
 * Never logged, wherever they appear. Request and response serializers
 * below already leave headers and bodies out; this list is the backstop
 * for anything logged some other way (NFR-5).
 */
export const REDACTED_PATHS = [
  "req.headers.cookie",
  "req.headers.authorization",
  'req.headers["x-csrf-token"]',
  'res.headers["set-cookie"]',
  "*.password",
  "*.token",
  "*.cookie",
  "*.authorization",
];

const HEALTH_CHECK_PATHS = new Set(["/health", "/ready"]);

interface SerializedRequest {
  id: unknown;
  method: string;
  url: string;
  remoteAddress?: string;
}

export function loggingModule(
  env: Env,
  destination?: DestinationStream,
): DynamicModule {
  const options: PinoHttpOptions = {
    level: env.LOG_LEVEL,
    redact: { paths: REDACTED_PATHS, censor: "[redacted]" },
    // Only what is needed to follow a request: no headers, no query
    // string, no body.
    serializers: {
      req: (req: SerializedRequest) => ({
        id: req.id,
        method: req.method,
        path: requestPath(req.url),
        remoteAddress: req.remoteAddress,
      }),
      res: (res: { statusCode: number }) => ({ statusCode: res.statusCode }),
    },
    customLogLevel: (
      _req: IncomingMessage,
      res: ServerResponse,
      error?: Error,
    ) => {
      if (error !== undefined || res.statusCode >= 500) return "error";
      if (res.statusCode >= 400) return "warn";
      return "info";
    },
    // Orchestrator health checks run every few seconds and tell us
    // nothing per call. The middleware layer rewrites `url` relative to its
    // mount point, so match on the original URL.
    autoLogging: {
      ignore: (req: IncomingMessage & { originalUrl?: string }) =>
        HEALTH_CHECK_PATHS.has(requestPath(req.originalUrl ?? req.url ?? "")),
    },
  };
  return LoggerModule.forRoot({
    pinoHttp: destination === undefined ? options : [options, destination],
  });
}
