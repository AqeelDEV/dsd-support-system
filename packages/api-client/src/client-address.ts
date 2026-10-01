/**
 * The browser's real address, worked out where it can be: in the web app's
 * Node server, before Next.js sees the request (ADR-0010).
 *
 * Next.js only fills in X-Forwarded-For when a request arrives without one,
 * and a route handler can't see the TCP connection. So a client talking to
 * the app directly could name any address it liked, and the API would
 * count its sign-in attempts against that address. This module replaces
 * the header with an address it trusts, using the same rule the API uses
 * for its own proxies: walk back from the connection through
 * X-Forwarded-For only while each hop is a configured trusted proxy.
 *
 * Node only. The web apps load it from `instrumentation.ts`.
 */
import { randomBytes, timingSafeEqual } from "node:crypto";
import { subscribe } from "node:diagnostics_channel";
import type { IncomingMessage } from "node:http";
import { BlockList, isIP } from "node:net";

import { SEAL_HEADER } from "./proxy";

const STATE = Symbol.for("dsd.client-address-hook");

interface HookState {
  seal: string;
}

function hookState(): HookState | undefined {
  return (globalThis as Record<symbol, HookState | undefined>)[STATE];
}

/** `::ffff:192.0.2.1` and `192.0.2.1` are the same IPv4 client. */
function normalize(address: string): string {
  const trimmed = address.trim();
  return trimmed.toLowerCase().startsWith("::ffff:") &&
    isIP(trimmed.slice(7)) === 4
    ? trimmed.slice(7)
    : trimmed;
}

const family = (address: string): "ipv4" | "ipv6" =>
  isIP(address) === 4 ? "ipv4" : "ipv6";

/**
 * Parses a comma-separated list of proxy addresses and CIDR ranges, the
 * same format as the API's TRUST_PROXY. Empty means nothing in front of
 * the app is trusted, which is right when browsers connect to it directly.
 */
export function parseTrustedProxies(value: string | undefined): BlockList {
  const trusted = new BlockList();
  const invalid: string[] = [];
  for (const entry of (value ?? "").split(",").map((item) => item.trim())) {
    if (entry === "") continue;
    const [address = "", prefix, ...rest] = entry.split("/");
    const version = isIP(address);
    const bits = Number(prefix);
    if (version === 0 || rest.length > 0) {
      invalid.push(entry);
    } else if (prefix === undefined) {
      trusted.addAddress(address, family(address));
    } else if (
      Number.isInteger(bits) &&
      bits >= 0 &&
      bits <= (version === 4 ? 32 : 128)
    ) {
      trusted.addSubnet(address, bits, family(address));
    } else {
      invalid.push(entry);
    }
  }
  if (invalid.length > 0) {
    throw new Error(
      `TRUST_PROXY: not an IP address or CIDR range: ${invalid.join(", ")}`,
    );
  }
  return trusted;
}

/**
 * The client's address: the connection's peer, unless that peer is a
 * trusted proxy, in which case the address it reported, and so on back
 * through the chain. Entries a client added itself are never reached,
 * because the walk stops at the first hop that isn't trusted.
 */
export function resolveClientAddress(
  peer: string | undefined,
  forwardedFor: string | string[] | undefined,
  trusted: BlockList,
): string | undefined {
  if (peer === undefined || isIP(normalize(peer)) === 0) return undefined;
  const reported = [forwardedFor ?? []]
    .flat()
    .flatMap((header) => header.split(","))
    .map(normalize)
    .reverse();
  let address = normalize(peer);
  for (const next of reported) {
    if (!trusted.check(address, family(address))) break;
    if (isIP(next) === 0) break;
    address = next;
  }
  return address;
}

/**
 * Rewrites X-Forwarded-For on every request this process receives, before
 * any request handler runs (Node publishes `http.server.request.start`
 * before it emits `request`). Safe to call more than once.
 */
export function installClientAddressHook(trustProxy: string | undefined): void {
  if (hookState() !== undefined) return;
  const trusted = parseTrustedProxies(trustProxy);
  const seal = randomBytes(32).toString("base64url");
  subscribe("http.server.request.start", (message) => {
    const { request } = message as { request: IncomingMessage };
    const address = resolveClientAddress(
      request.socket.remoteAddress,
      request.headers["x-forwarded-for"],
      trusted,
    );
    if (address === undefined) {
      delete request.headers["x-forwarded-for"];
    } else {
      request.headers["x-forwarded-for"] = address;
    }
    // Next.js starts listening before it runs instrumentation, so a request
    // can arrive before this hook exists. The seal, a random key that never
    // leaves this process, tells the proxy which addresses the hook wrote.
    request.headers[SEAL_HEADER] = seal;
  });
  (globalThis as Record<symbol, HookState | undefined>)[STATE] = { seal };
}

let warnedMissingHook = false;

/**
 * The client address the hook worked out for this request, or undefined
 * if the hook didn't handle it. Undefined means the API sees the web app's
 * own address: rate limits get coarser, but nobody can choose their address.
 */
export function forwardedClientAddress(headers: Headers): string | undefined {
  const state = hookState();
  if (state === undefined) {
    if (!warnedMissingHook) {
      warnedMissingHook = true;
      process.emitWarning(
        "The client address hook isn't installed, so the API won't see browsers' addresses. Is instrumentation.ts in place?",
        { code: "DSD_CLIENT_ADDRESS_HOOK_MISSING" },
      );
    }
    return undefined;
  }
  const seal = Buffer.from(headers.get(SEAL_HEADER) ?? "", "utf8");
  const expected = Buffer.from(state.seal, "utf8");
  if (seal.length !== expected.length || !timingSafeEqual(seal, expected)) {
    return undefined;
  }
  const address = headers.get("x-forwarded-for");
  return address !== null && isIP(address) !== 0 ? address : undefined;
}

/**
 * For a web app's `instrumentation.ts`: installs the hook with the app's
 * TRUST_PROXY setting, or stops the process if the setting is invalid.
 * Left to itself, Next.js would keep listening and answer every request
 * with a 500.
 */
export function startClientAddressHook(): void {
  try {
    installClientAddressHook(process.env.TRUST_PROXY);
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exit(1);
  }
}
