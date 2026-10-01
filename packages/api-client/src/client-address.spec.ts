import http from "node:http";
import type { AddressInfo } from "node:net";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  forwardedClientAddress,
  installClientAddressHook,
  parseTrustedProxies,
  resolveClientAddress,
} from "./client-address";
import { SEAL_HEADER } from "./proxy";

describe("parseTrustedProxies", () => {
  it("accepts addresses and CIDR ranges of both families", () => {
    const trusted = parseTrustedProxies(
      " 10.250.73.10, 10.0.0.0/8 ,fd00::/8, ::1",
    );
    expect(trusted.check("10.250.73.10", "ipv4")).toBe(true);
    expect(trusted.check("10.9.8.7", "ipv4")).toBe(true);
    expect(trusted.check("fd12::1", "ipv6")).toBe(true);
    expect(trusted.check("::1", "ipv6")).toBe(true);
    expect(trusted.check("192.0.2.1", "ipv4")).toBe(false);
  });

  it("trusts nothing when empty", () => {
    expect(parseTrustedProxies(undefined).check("127.0.0.1", "ipv4")).toBe(
      false,
    );
    expect(parseTrustedProxies("").check("127.0.0.1", "ipv4")).toBe(false);
  });

  it.each(["proxy.internal", "10.0.0.0/33", "10.0.0.1/8/1", "::1/129"])(
    "refuses %s, so a typo can't silently trust everyone or no one",
    (entry) => {
      expect(() => parseTrustedProxies(`127.0.0.1,${entry}`)).toThrow(entry);
    },
  );
});

describe("resolveClientAddress", () => {
  const nothing = parseTrustedProxies("");
  const loadBalancer = parseTrustedProxies("10.0.0.5");
  const twoHops = parseTrustedProxies("10.0.0.5, 10.0.1.0/24");

  it("uses the connection's peer when nothing is trusted, whatever the header says", () => {
    expect(resolveClientAddress("198.51.100.7", "203.0.113.66", nothing)).toBe(
      "198.51.100.7",
    );
  });

  it("uses the peer when there is no header", () => {
    expect(resolveClientAddress("198.51.100.7", undefined, loadBalancer)).toBe(
      "198.51.100.7",
    );
  });

  it("believes a trusted proxy about the address it saw", () => {
    expect(resolveClientAddress("10.0.0.5", "198.51.100.7", loadBalancer)).toBe(
      "198.51.100.7",
    );
  });

  it("ignores what the client wrote before the trusted proxy appended its view", () => {
    expect(
      resolveClientAddress(
        "10.0.0.5",
        "203.0.113.66, 198.51.100.7",
        loadBalancer,
      ),
    ).toBe("198.51.100.7");
  });

  it("walks back through every trusted hop, and no further", () => {
    expect(
      resolveClientAddress(
        "10.0.0.5",
        ["203.0.113.66, 198.51.100.7", "10.0.1.20"],
        twoHops,
      ),
    ).toBe("198.51.100.7");
  });

  it("stops at an entry that isn't an address", () => {
    expect(resolveClientAddress("10.0.0.5", "not-an-ip", loadBalancer)).toBe(
      "10.0.0.5",
    );
  });

  it("treats an IPv4-mapped IPv6 address as the IPv4 address", () => {
    expect(
      resolveClientAddress(
        "::ffff:10.0.0.5",
        "::FFFF:198.51.100.7",
        loadBalancer,
      ),
    ).toBe("198.51.100.7");
  });

  it("has no answer without a peer address", () => {
    expect(
      resolveClientAddress(undefined, "198.51.100.7", loadBalancer),
    ).toBeUndefined();
  });
});

/**
 * The hook against a real Node HTTP server, the kind Next.js runs: it must
 * rewrite the header before the request handler sees it. One process gets
 * one hook, so this installs it once, trusting loopback as a stand-in for
 * a load balancer.
 */
describe("installClientAddressHook", () => {
  const seen: http.IncomingHttpHeaders[] = [];
  const server = http.createServer((request, response) => {
    seen.push({ ...request.headers });
    response.end();
  });
  let url: string;

  beforeAll(async () => {
    installClientAddressHook("127.0.0.1, ::1");
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => {
      server.close(() => {
        resolve();
      });
    });
  });

  const send = async (headers: Record<string, string>) => {
    seen.length = 0;
    await fetch(url, { headers });
    const [received] = seen;
    if (received === undefined) throw new Error("the server saw nothing");
    return received;
  };

  it("rewrites X-Forwarded-For before the handler runs, and seals it", async () => {
    const received = await send({
      "x-forwarded-for": "203.0.113.66, 198.51.100.7",
    });
    expect(received["x-forwarded-for"]).toBe("198.51.100.7");
    expect(received[SEAL_HEADER]).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("writes the peer's own address when there is no header", async () => {
    const received = await send({});
    expect(received["x-forwarded-for"]).toBe("127.0.0.1");
  });

  it("overwrites a seal the client tried to send", async () => {
    const received = await send({ [SEAL_HEADER]: "guessed" });
    expect(received[SEAL_HEADER]).not.toBe("guessed");
  });

  it("installs only once", async () => {
    installClientAddressHook("");
    const received = await send({ "x-forwarded-for": "198.51.100.8" });
    expect(received["x-forwarded-for"]).toBe("198.51.100.8");
  });

  describe("forwardedClientAddress", () => {
    const headersOf = (received: http.IncomingHttpHeaders) =>
      new Headers(
        Object.entries(received).flatMap(([name, value]) =>
          typeof value === "string" ? [[name, value] as [string, string]] : [],
        ),
      );

    it("returns the address the hook wrote", async () => {
      const received = await send({ "x-forwarded-for": "198.51.100.9" });
      expect(forwardedClientAddress(headersOf(received))).toBe("198.51.100.9");
    });

    it("ignores an address without this process's seal", () => {
      expect(
        forwardedClientAddress(
          new Headers({
            "x-forwarded-for": "203.0.113.66",
            [SEAL_HEADER]: "guessed",
          }),
        ),
      ).toBeUndefined();
      expect(
        forwardedClientAddress(
          new Headers({ "x-forwarded-for": "203.0.113.66" }),
        ),
      ).toBeUndefined();
    });
  });
});
