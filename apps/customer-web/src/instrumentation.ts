/**
 * Runs once when the server starts. It installs the hook that replaces
 * X-Forwarded-For with the browser's real address before Next.js sees a
 * request, so the API's rate limits and session records can't be fooled
 * by a client naming its own address (ADR-0010).
 *
 * TRUST_PROXY lists the proxies in front of this app whose
 * X-Forwarded-For is believed. Leave it empty when browsers connect
 * directly, as they do in Docker Compose. An invalid value stops the
 * server.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { startClientAddressHook } =
    await import("@dsd/api-client/client-address");
  startClientAddressHook();
}
