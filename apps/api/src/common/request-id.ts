import { randomUUID } from "node:crypto";
import type { IncomingMessage } from "node:http";

export const REQUEST_ID_HEADER = "x-request-id";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Keeps the caller's request ID only if it is a UUID, so a client can't
 * write arbitrary text into our logs and audit rows. Otherwise a new one
 * is generated.
 */
export function resolveRequestId(
  header: string | string[] | undefined,
): string {
  const value = Array.isArray(header) ? header[0] : header;
  return value !== undefined && UUID.test(value)
    ? value.toLowerCase()
    : randomUUID();
}

/**
 * Fastify's request-ID generator. It also stores the ID on the raw Node
 * request, where the pino-http request logger looks for it, so the access
 * log, application logs and error responses all carry the same ID.
 */
export function assignRequestId(raw: IncomingMessage): string {
  const id = resolveRequestId(raw.headers[REQUEST_ID_HEADER]);
  raw.id = id;
  return id;
}
