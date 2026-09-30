/**
 * The same-origin API proxy used by both web apps (ADR-0003, section 4).
 *
 * The browser only ever talks to its own app, which forwards `/api/*` to
 * the API over the internal network. That keeps session cookies on the
 * app's own host and removes any need for CORS.
 *
 * Each app forwards only its own realm's routes, so the customer app can't
 * be used to reach staff endpoints even by hand-crafted requests. That is
 * an extra layer: the API enforces the realm boundary on its own.
 *
 * The handler takes a standard Request and returns a standard Response, so
 * it runs in a Next.js route handler and is testable without Next.js. It
 * streams request bodies rather than using Next.js rewrites: rewrites are
 * fixed at build time in standalone output, and the rewrite proxy caps
 * request bodies at 10 MB, below what attachment uploads need.
 */

/**
 * The API route prefixes each app may forward, by realm (ADR-0003). The
 * customer app never forwards staff routes, and the agent app never
 * forwards customer or public ones.
 */
export const REALM_PREFIXES = {
  customer: ["/api/v1/public/", "/api/v1/auth/customer/", "/api/v1/customer/"],
  staff: ["/api/v1/auth/staff/", "/api/v1/staff/"],
} as const satisfies Record<string, readonly string[]>;

export interface ApiProxyOptions {
  /** Base URL of the API on the internal network, for example `http://api:4000`. */
  upstream: string;
  /** Path prefixes this app may forward, each ending in `/`. */
  allowedPrefixes: readonly string[];
}

/** Connection-level headers that must not be forwarded (RFC 9110, section 7.6.1). */
const HOP_BY_HOP = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "proxy-connection",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

/** Set by fetch for the upstream request, never copied from the browser. */
const REQUEST_HEADERS_TO_DROP = new Set([
  ...HOP_BY_HOP,
  "host",
  "x-forwarded-host",
  "x-forwarded-proto",
]);

/**
 * fetch decompresses the upstream body, so the original encoding and length
 * no longer describe what is sent on. Cookies are copied separately so that
 * several of them survive.
 */
const RESPONSE_HEADERS_TO_DROP = new Set([
  ...HOP_BY_HOP,
  "content-encoding",
  "content-length",
  "set-cookie",
]);

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** An encoded `/` or `\` could hide a path segment from the prefix check. */
const ENCODED_SEPARATOR = /%2f|%5c/i;

function problem(
  status: number,
  title: string,
  detail: string,
  requestId: string,
): Response {
  return new Response(
    JSON.stringify({ type: "about:blank", title, status, detail, requestId }),
    {
      status,
      headers: {
        "content-type": "application/problem+json",
        "x-request-id": requestId,
      },
    },
  );
}

export function createApiProxy(
  options: ApiProxyOptions,
): (request: Request) => Promise<Response> {
  const upstream = new URL(options.upstream);

  return async function proxy(request: Request): Promise<Response> {
    const url = new URL(request.url);
    // Keep a well-formed request ID from the browser, otherwise mint one
    // here, so the proxy's own errors and the API's logs share an ID.
    const incomingId = request.headers.get("x-request-id");
    const requestId =
      incomingId !== null && UUID.test(incomingId)
        ? incomingId
        : crypto.randomUUID();

    // `URL` has already resolved `.` and `..` segments, so this is the path
    // the API will see.
    const path = url.pathname;
    if (
      ENCODED_SEPARATOR.test(path) ||
      !options.allowedPrefixes.some((prefix) => path.startsWith(prefix))
    ) {
      return problem(
        404,
        "Not Found",
        "No such API route in this app.",
        requestId,
      );
    }

    const headers = new Headers();
    request.headers.forEach((value, key) => {
      if (!REQUEST_HEADERS_TO_DROP.has(key)) headers.set(key, value);
    });
    headers.set("x-request-id", requestId);
    headers.set("x-forwarded-host", url.host);
    headers.set("x-forwarded-proto", url.protocol.slice(0, -1));

    const hasBody =
      request.method !== "GET" &&
      request.method !== "HEAD" &&
      request.body !== null;
    let upstreamResponse: Response;
    try {
      upstreamResponse = await fetch(
        new URL(`${path}${url.search}`, upstream),
        {
          method: request.method,
          headers,
          ...(hasBody ? { body: request.body, duplex: "half" } : {}),
          redirect: "manual",
          signal: request.signal,
        },
      );
    } catch {
      return problem(
        502,
        "Bad Gateway",
        "The support API is unreachable. Try again shortly.",
        requestId,
      );
    }

    const responseHeaders = new Headers();
    upstreamResponse.headers.forEach((value, key) => {
      if (!RESPONSE_HEADERS_TO_DROP.has(key)) responseHeaders.set(key, value);
    });
    for (const cookie of upstreamResponse.headers.getSetCookie()) {
      responseHeaders.append("set-cookie", cookie);
    }

    return new Response(upstreamResponse.body, {
      status: upstreamResponse.status,
      statusText: upstreamResponse.statusText,
      headers: responseHeaders,
    });
  };
}
