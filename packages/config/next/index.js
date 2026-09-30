import path from "node:path";

/**
 * Response headers for every page (NFR-7). The CSP here only covers what
 * needs no per-request nonce: framing, plugins, base URLs and form targets.
 * A nonce-based script-src comes with the real pages.
 */
const securityHeaders = [
  {
    key: "Content-Security-Policy",
    value:
      "frame-ancestors 'none'; object-src 'none'; base-uri 'self'; form-action 'self'",
  },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  },
];

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
    headers() {
      return Promise.resolve([{ source: "/:path*", headers: securityHeaders }]);
    },
  };
}
