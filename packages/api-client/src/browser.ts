import createClient, { type Middleware } from "openapi-fetch";

import type { paths } from "./schema";

/*
 * The client the web apps use in the browser. Every call goes to the app's
 * own origin, and its `/api` proxy forwards it to the API (ADR-0003, section
 * 4), so the browser never talks to the API directly and needs no CORS.
 */

export type Realm = "customer" | "staff";

const UNSAFE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * The CSRF token for a realm, read from its script-readable cookie at the
 * moment of the request (ADR-0003). Reading it each time, rather than
 * keeping a copy, means a sign-in in another tab never leaves this tab
 * with a stale token. Production cookies carry the `__Host-` prefix; the
 * local http mode drops it.
 */
export function csrfTokenFrom(
  cookieHeader: string,
  realm: Realm,
): string | undefined {
  const names = new Set([`__Host-dsd_${realm}_csrf`, `dsd_${realm}_csrf`]);
  for (const part of cookieHeader.split(";")) {
    const separator = part.indexOf("=");
    if (separator === -1) continue;
    const name = part.slice(0, separator).trim();
    if (names.has(name)) {
      const value = part.slice(separator + 1).trim();
      return value === "" ? undefined : decodeURIComponent(value);
    }
  }
  return undefined;
}

/** Adds `X-CSRF-Token` to every state-changing request that has a session. */
export function csrfMiddleware(
  realm: Realm,
  cookies: () => string,
): Middleware {
  return {
    onRequest({ request }) {
      if (!UNSAFE_METHODS.has(request.method)) return undefined;
      const token = csrfTokenFrom(cookies(), realm);
      if (token !== undefined) request.headers.set("x-csrf-token", token);
      return request;
    },
  };
}

export interface ProblemFieldError {
  path: string;
  message: string;
}

/**
 * An API failure as RFC 9457 problem details, plus what the apps need to
 * explain it: the HTTP status, the request ID to quote to support, and how
 * long to wait after a 429 or 503. Status 0 means the request never got an
 * answer (offline, or the proxy couldn't reach the API).
 */
export class ApiProblem extends Error {
  readonly status: number;
  readonly type: string;
  readonly title: string;
  readonly detail: string | undefined;
  readonly errors: readonly ProblemFieldError[];
  readonly allowedTransitions: readonly string[] | undefined;
  readonly requestId: string | undefined;
  readonly retryAfterSeconds: number | undefined;

  constructor(init: {
    status: number;
    type?: string;
    title?: string;
    detail?: string;
    errors?: readonly ProblemFieldError[];
    allowedTransitions?: readonly string[];
    requestId?: string;
    retryAfterSeconds?: number;
  }) {
    super(
      init.detail ?? init.title ?? `Request failed with status ${init.status}`,
    );
    this.name = "ApiProblem";
    this.status = init.status;
    this.type = init.type ?? "about:blank";
    this.title = init.title ?? "Something went wrong";
    this.detail = init.detail;
    this.errors = init.errors ?? [];
    this.allowedTransitions = init.allowedTransitions;
    this.requestId = init.requestId;
    this.retryAfterSeconds = init.retryAfterSeconds;
  }

  /** Builds the error from a failed response and whatever openapi-fetch parsed from its body. */
  static from(response: Response, body: unknown): ApiProblem {
    const problem = isRecord(body) ? body : {};
    const retryAfter = Number(response.headers.get("retry-after"));
    return new ApiProblem({
      status: response.status,
      type: stringOf(problem.type),
      title: stringOf(problem.title),
      detail: stringOf(problem.detail),
      errors: Array.isArray(problem.errors)
        ? problem.errors.filter(isFieldError)
        : [],
      allowedTransitions: Array.isArray(problem.allowedTransitions)
        ? problem.allowedTransitions.filter(
            (value) => typeof value === "string",
          )
        : undefined,
      requestId:
        stringOf(problem.requestId) ??
        response.headers.get("x-request-id") ??
        undefined,
      retryAfterSeconds:
        Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : undefined,
    });
  }

  /** The request never reached the API. */
  static network(cause: unknown): ApiProblem {
    const problem = new ApiProblem({
      status: 0,
      title: "Can't reach the server",
      detail: "Check your connection and try again.",
    });
    problem.cause = cause;
    return problem;
  }

  /** The message for one form field, if the API rejected it. */
  fieldError(field: string): string | undefined {
    return this.errors.find(
      (error) => error.path === field || error.path.startsWith(`${field}.`),
    )?.message;
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const stringOf = (value: unknown): string | undefined =>
  typeof value === "string" ? value : undefined;

const isFieldError = (value: unknown): value is ProblemFieldError =>
  isRecord(value) &&
  typeof value.path === "string" &&
  typeof value.message === "string";

/**
 * The data of a call, or an `ApiProblem` thrown for anything but a 2xx.
 * Network failures become status 0, so callers handle one error type.
 */
export async function ok<T>(
  call: Promise<{ data?: T; error?: unknown; response: Response }>,
): Promise<T> {
  let result: { data?: T; error?: unknown; response: Response };
  try {
    result = await call;
  } catch (cause) {
    throw ApiProblem.network(cause);
  }
  if (!result.response.ok) throw ApiProblem.from(result.response, result.error);
  return result.data as T;
}

/**
 * A multipart body with every text field before the first file, as the
 * API requires (ADR-0011): it validates the fields before reading a byte
 * of any file. Empty optional fields are left out.
 */
export function multipart(
  fields: Record<string, string | undefined>,
  files: readonly File[] = [],
  fileField = "attachments",
): FormData {
  const form = new FormData();
  for (const [name, value] of Object.entries(fields)) {
    if (value !== undefined && value !== "") form.append(name, value);
  }
  for (const file of files) form.append(fileField, file, file.name);
  return form;
}

/** Sends a FormData body untouched, so the browser sets the multipart boundary. */
export const formDataBody = {
  bodySerializer: (body: unknown) => body as FormData,
};

export function createBrowserClient(realm: Realm) {
  const client = createClient<paths>({ baseUrl: "" });
  client.use(
    csrfMiddleware(realm, () =>
      typeof document === "undefined" ? "" : document.cookie,
    ),
  );
  return client;
}

export type BrowserClient = ReturnType<typeof createBrowserClient>;
