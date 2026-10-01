import { STATUS_CODES } from "node:http";

import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from "@nestjs/common";
import {
  PROBLEM_JSON,
  PROBLEM_TYPES,
  type ProblemDetails,
  type ValidationIssue,
} from "@dsd/shared";
import type { FastifyReply, FastifyRequest } from "fastify";
import { ZodValidationException } from "nestjs-zod";
import type { ZodError } from "zod";

import { requestPath } from "./url.js";

interface RequestContext {
  requestId: string;
  path: string;
}

const title = (status: number) => STATUS_CODES[status] ?? "Error";

type ProblemType = (typeof PROBLEM_TYPES)[keyof typeof PROBLEM_TYPES];

/**
 * An error with its own problem type, for cases a client handles
 * differently from a plain status: a rejected CSRF token means "fetch a
 * fresh one", a rate limit means "wait". Extra headers such as
 * `Retry-After` travel with it.
 */
export class ProblemException extends HttpException {
  constructor(
    status: number,
    readonly problemType: ProblemType,
    detail: string,
    readonly headers: Readonly<Record<string, string>> = {},
  ) {
    super(detail, status);
  }
}

const UNEXPECTED_DETAIL =
  "An unexpected error occurred. Quote the request ID if you report it.";

function validationIssues(error: ZodError): ValidationIssue[] {
  return error.issues.map((issue) => ({
    path: issue.path.map(String).join("."),
    message: issue.message,
  }));
}

function httpExceptionDetail(exception: HttpException): string | undefined {
  const response = exception.getResponse();
  if (typeof response === "string") return response;
  if (typeof response === "object" && "message" in response) {
    const { message } = response;
    if (typeof message === "string") return message;
    if (Array.isArray(message)) return message.map(String).join("; ");
  }
  return undefined;
}

/**
 * Errors raised by Fastify itself before a route handler runs: malformed
 * JSON, an unsupported content type, a body over the size limit. They
 * carry a 4xx `statusCode` and a message written for the client.
 */
function isFastifyClientError(
  exception: unknown,
): exception is Error & { statusCode: number; code: string } {
  return (
    exception instanceof Error &&
    "statusCode" in exception &&
    typeof exception.statusCode === "number" &&
    exception.statusCode >= 400 &&
    exception.statusCode < 500 &&
    "code" in exception &&
    typeof exception.code === "string" &&
    exception.code.startsWith("FST_")
  );
}

/**
 * Turns anything thrown while handling a request into RFC 9457 problem
 * details. Client errors keep their message; server errors never expose
 * theirs, because it may contain internals.
 */
export function toProblem(
  exception: unknown,
  context: RequestContext,
): ProblemDetails {
  const base = { instance: context.path, requestId: context.requestId };

  if (exception instanceof ZodValidationException) {
    return {
      type: PROBLEM_TYPES.validation,
      title: title(HttpStatus.BAD_REQUEST),
      status: HttpStatus.BAD_REQUEST,
      detail: "The request is invalid.",
      ...base,
      errors: validationIssues(exception.getZodError() as ZodError),
    };
  }

  if (exception instanceof HttpException) {
    const status = exception.getStatus();
    // A ProblemException's detail is written for the client, even for a
    // deliberate 503; any other server error's message may hold internals.
    const detail =
      status < 500 || exception instanceof ProblemException
        ? httpExceptionDetail(exception)
        : UNEXPECTED_DETAIL;
    return {
      type:
        exception instanceof ProblemException
          ? exception.problemType
          : PROBLEM_TYPES.blank,
      title: title(status),
      status,
      ...(detail === undefined ? {} : { detail }),
      ...base,
    };
  }

  if (isFastifyClientError(exception)) {
    return {
      type: PROBLEM_TYPES.blank,
      title: title(exception.statusCode),
      status: exception.statusCode,
      detail: exception.message,
      ...base,
    };
  }

  return {
    type: PROBLEM_TYPES.blank,
    title: title(HttpStatus.INTERNAL_SERVER_ERROR),
    status: HttpStatus.INTERNAL_SERVER_ERROR,
    detail: UNEXPECTED_DETAIL,
    ...base,
  };
}

const logger = new Logger("Errors");

export function sendProblem(
  exception: unknown,
  request: FastifyRequest,
  reply: FastifyReply,
): void {
  const problem = toProblem(exception, {
    requestId: request.id,
    path: requestPath(request.url),
  });
  if (problem.status >= 500 && !(exception instanceof ProblemException)) {
    logger.error(
      exception instanceof Error
        ? (exception.stack ?? exception.message)
        : String(exception),
    );
  }
  if (exception instanceof ProblemException) {
    void reply.headers(exception.headers);
  }
  void reply
    .status(problem.status)
    .header("content-type", PROBLEM_JSON)
    .send(problem);
}

/** Every error from a Nest route, including unknown routes, becomes problem details. */
@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    sendProblem(
      exception,
      http.getRequest<FastifyRequest>(),
      http.getResponse<FastifyReply>(),
    );
  }
}
