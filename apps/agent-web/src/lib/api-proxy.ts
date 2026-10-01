import { forwardedClientAddress } from "@dsd/api-client/client-address";
import { createApiProxy, REALM_PREFIXES } from "@dsd/api-client/proxy";

/**
 * Where the API lives on the internal network. Read at runtime, not at
 * build time, so one image runs in any environment.
 */
function apiUpstream(): string {
  const url = process.env.API_INTERNAL_URL;
  if (url !== undefined && url.length > 0) return url;
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "API_INTERNAL_URL must be set, for example http://api:4000",
    );
  }
  return "http://localhost:4000";
}

let proxy: ((request: Request) => Promise<Response>) | undefined;

/** Forwards the staff realm's API routes, and only those. */
export function apiProxy(request: Request): Promise<Response> {
  proxy ??= createApiProxy({
    upstream: apiUpstream(),
    allowedPrefixes: REALM_PREFIXES.staff,
    // The address src/instrumentation.ts worked out, never the browser's claim.
    clientAddress: (incoming) => forwardedClientAddress(incoming.headers),
  });
  return proxy(request);
}
