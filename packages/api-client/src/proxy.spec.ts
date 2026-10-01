import http from "node:http";
import type { AddressInfo } from "node:net";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createApiProxy, REALM_PREFIXES, SEAL_HEADER } from "./proxy";

interface SeenRequest {
  method: string | undefined;
  url: string | undefined;
  headers: http.IncomingHttpHeaders;
  body: string;
}

/** A stand-in API that records what reached it and answers with two cookies. */
function startUpstream() {
  const seen: SeenRequest[] = [];
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      seen.push({
        method: req.method,
        url: req.url,
        headers: req.headers,
        body: Buffer.concat(chunks).toString("utf8"),
      });
      // A download carries the API's own sandboxing headers (ADR-0009).
      const download = req.url?.includes("/attachments/") === true;
      res.writeHead(201, {
        "content-type": "application/json",
        "set-cookie": [
          "dsd_customer_session=abc; HttpOnly; Path=/",
          "dsd_customer_csrf=def; Path=/",
        ],
        connection: "keep-alive",
        "x-request-id": "0199a1b2-0000-7000-8000-0000000000ff",
        ...(download
          ? {
              "content-security-policy": "default-src 'none'; sandbox",
              "content-disposition": "attachment; filename*=UTF-8''log.txt",
            }
          : {}),
      });
      res.end(JSON.stringify({ ok: true }));
    });
  });
  return { server, seen };
}

const CUSTOMER_PREFIXES = REALM_PREFIXES.customer;
const APP = "https://support.dsd.example";

describe("createApiProxy", () => {
  const { server, seen } = startUpstream();
  let proxy: (request: Request) => Promise<Response>;
  /** What the app's client-address hook would report for the next request. */
  let clientAddress: string | undefined;

  beforeAll(async () => {
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const { port } = server.address() as AddressInfo;
    proxy = createApiProxy({
      upstream: `http://127.0.0.1:${port}`,
      allowedPrefixes: CUSTOMER_PREFIXES,
      clientAddress: () => clientAddress,
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => {
      server.close(() => {
        resolve();
      });
    });
  });

  beforeEach(() => {
    seen.length = 0;
    clientAddress = "198.51.100.23";
  });

  it("forwards the method, path, query, body and application headers", async () => {
    const response = await proxy(
      new Request(`${APP}/api/v1/customer/tickets?limit=10`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: "dsd_customer_session=abc",
          "x-csrf-token": "token-value",
        },
        body: JSON.stringify({ subject: "Card declined" }),
      }),
    );

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ ok: true });
    expect(seen).toHaveLength(1);
    const [request] = seen;
    expect(request).toMatchObject({
      method: "POST",
      url: "/api/v1/customer/tickets?limit=10",
      body: JSON.stringify({ subject: "Card declined" }),
    });
    expect(request?.headers).toMatchObject({
      "content-type": "application/json",
      cookie: "dsd_customer_session=abc",
      "x-csrf-token": "token-value",
      "x-forwarded-for": "198.51.100.23",
      "x-forwarded-host": "support.dsd.example",
      "x-forwarded-proto": "https",
    });
  });

  it("replaces forwarding headers the browser tried to set", async () => {
    await proxy(
      new Request(`${APP}/api/v1/public/kb/articles`, {
        headers: {
          "x-forwarded-host": "evil.example",
          "x-forwarded-proto": "gopher",
        },
      }),
    );
    expect(seen[0]?.headers).toMatchObject({
      "x-forwarded-host": "support.dsd.example",
      "x-forwarded-proto": "https",
      host: expect.stringMatching(/^127\.0\.0\.1:\d+$/) as unknown,
    });
  });

  it("forwards only the client address the app worked out, never the browser's own claim", async () => {
    await proxy(
      new Request(`${APP}/api/v1/public/kb/articles`, {
        headers: {
          "x-forwarded-for": "203.0.113.66",
          [SEAL_HEADER]: "guessed",
        },
      }),
    );
    expect(seen[0]?.headers["x-forwarded-for"]).toBe("198.51.100.23");
    expect(seen[0]?.headers[SEAL_HEADER]).toBeUndefined();
  });

  it("sends no X-Forwarded-For when the app doesn't know the address", async () => {
    clientAddress = undefined;
    await proxy(
      new Request(`${APP}/api/v1/public/kb/articles`, {
        headers: { "x-forwarded-for": "203.0.113.66" },
      }),
    );
    expect(seen[0]?.headers["x-forwarded-for"]).toBeUndefined();
  });

  it("doesn't forward hop-by-hop headers", async () => {
    await proxy(
      new Request(`${APP}/api/v1/public/kb/articles`, {
        headers: {
          "proxy-authorization": "Basic c2VjcmV0",
          trailer: "expires",
        },
      }),
    );
    expect(seen[0]?.headers).not.toHaveProperty("proxy-authorization");
    expect(seen[0]?.headers).not.toHaveProperty("trailer");
  });

  it("passes the API's own security headers through untouched", async () => {
    const response = await proxy(
      new Request(`${APP}/api/v1/customer/tickets/x/attachments/y`),
    );
    expect(response.headers.get("content-security-policy")).toBe(
      "default-src 'none'; sandbox",
    );
    expect(response.headers.get("content-disposition")).toBe(
      "attachment; filename*=UTF-8''log.txt",
    );
  });

  it("keeps every Set-Cookie header and drops connection headers from the response", async () => {
    const response = await proxy(
      new Request(`${APP}/api/v1/auth/customer/login`, { method: "POST" }),
    );
    expect(response.headers.getSetCookie()).toEqual([
      "dsd_customer_session=abc; HttpOnly; Path=/",
      "dsd_customer_csrf=def; Path=/",
    ]);
    expect(response.headers.get("connection")).toBeNull();
  });

  it("passes a well-formed request ID through and mints one otherwise", async () => {
    const id = "0199a1b2-0000-7000-8000-000000000001";
    await proxy(
      new Request(`${APP}/api/v1/public/kb/articles`, {
        headers: { "x-request-id": id },
      }),
    );
    await proxy(
      new Request(`${APP}/api/v1/public/kb/articles`, {
        headers: { "x-request-id": "not-an-id" },
      }),
    );
    expect(seen[0]?.headers["x-request-id"]).toBe(id);
    expect(seen[1]?.headers["x-request-id"]).toMatch(/^[0-9a-f-]{36}$/);
  });

  it.each([
    ["another realm's route", "/api/v1/staff/tickets"],
    ["a route outside the API", "/internal/metrics"],
    ["a dot-segment escape", "/api/v1/customer/../staff/tickets"],
    ["an encoded dot-segment escape", "/api/v1/customer/%2e%2e/staff/tickets"],
    ["an encoded slash", "/api/v1/customer/..%2Fstaff/tickets"],
    ["an encoded backslash", "/api/v1/customer/..%5cstaff/tickets"],
    ["the bare prefix without its slash", "/api/v1/customerx"],
  ])("refuses %s without contacting the API", async (_label, path) => {
    const response = await proxy(new Request(`${APP}${path}`));

    expect(response.status).toBe(404);
    expect(response.headers.get("content-type")).toBe(
      "application/problem+json",
    );
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(seen).toHaveLength(0);
  });

  it("answers 502 with problem details when the API is unreachable", async () => {
    const closed = http.createServer();
    await new Promise<void>((resolve) =>
      closed.listen(0, "127.0.0.1", resolve),
    );
    const { port } = closed.address() as AddressInfo;
    await new Promise<void>((resolve) => {
      closed.close(() => {
        resolve();
      });
    });
    const unreachable = createApiProxy({
      upstream: `http://127.0.0.1:${port}`,
      allowedPrefixes: CUSTOMER_PREFIXES,
    });

    const response = await unreachable(
      new Request(`${APP}/api/v1/public/kb/articles`),
    );

    expect(response.status).toBe(502);
    const body = (await response.json()) as {
      status: number;
      requestId: string;
    };
    expect(body.status).toBe(502);
    expect(body.requestId).toBe(response.headers.get("x-request-id"));
  });
});

describe("REALM_PREFIXES", () => {
  const staffProxy = createApiProxy({
    upstream: "http://127.0.0.1:1",
    allowedPrefixes: REALM_PREFIXES.staff,
  });

  it.each([
    "/api/v1/customer/tickets",
    "/api/v1/auth/customer/login",
    "/api/v1/public/tickets",
  ])("keeps the agent app from forwarding %s", async (path) => {
    const response = await staffProxy(
      new Request(`https://desk.dsd.example${path}`),
    );
    expect(response.status).toBe(404);
  });

  it("keeps the two realms disjoint", () => {
    const overlap = REALM_PREFIXES.customer.filter((customer) =>
      REALM_PREFIXES.staff.some(
        (staff) => customer.startsWith(staff) || staff.startsWith(customer),
      ),
    );
    expect(overlap).toEqual([]);
  });
});
