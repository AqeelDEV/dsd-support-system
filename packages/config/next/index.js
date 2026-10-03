import path from "node:path";

/**
 * Response headers for every page (NFR-7). The Content Security Policy
 * needs a fresh nonce per response, so each app's proxy sets it
 * (`./csp.js`); these headers are the same on every response.
 */
const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  },
];

/**
 * HSTS for production builds: browsers then refuse plain HTTP for this host
 * for a year. They ignore the header on a plain-HTTP response (RFC 6797,
 * section 8.1), so the local Compose stack on http://localhost is
 * unaffected, and `next dev` never sends it.
 */
const strictTransportSecurity = {
  key: "Strict-Transport-Security",
  value: "max-age=31536000; includeSubDomains",
};

/** The headers every page gets in this environment. */
export function pageHeaders(nodeEnv = process.env.NODE_ENV) {
  return nodeEnv === "production"
    ? [...securityHeaders, strictTransportSecurity]
    : securityHeaders;
}

/**
 * The Next.js config both web apps share.
 *
 * @param {{ appDir: string }} options `appDir` is the app's own directory.
 */
export function createNextConfig({ appDir }) {
  return {
    // A self-contained server bundle for the container image.
    output: /** @type {const} */ ("standalone"),
    // Trace files from the repository root, so workspace packages are
    // included in the standalone bundle.
    outputFileTracingRoot: path.join(appDir, "../.."),
    // Workspace packages ship TypeScript source.
    transpilePackages: ["@dsd/ui", "@dsd/api-client"],
    poweredByHeader: false,
    reactStrictMode: true,
    // Pages only. Responses under /api/ come from the API through the proxy
    // and keep the API's own headers: a file download's sandboxing CSP
    // (ADR-0009) must not be replaced by the page policy.
    headers() {
      return Promise.resolve([
        { source: "/:path((?!api/).*)", headers: pageHeaders() },
      ]);
    },
  };
}
