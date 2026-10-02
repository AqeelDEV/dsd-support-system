import { describe, expect, it } from "vitest";

import {
  ApiProblem,
  csrfMiddleware,
  csrfTokenFrom,
  multipart,
  ok,
} from "./browser";

describe("csrfTokenFrom", () => {
  it("reads the realm's cookie, with or without the __Host- prefix", () => {
    expect(csrfTokenFrom("a=1; dsd_customer_csrf=abc; b=2", "customer")).toBe(
      "abc",
    );
    expect(csrfTokenFrom("__Host-dsd_staff_csrf=xyz", "staff")).toBe("xyz");
  });

  it("never reads the other realm's cookie", () => {
    expect(csrfTokenFrom("dsd_staff_csrf=xyz", "customer")).toBeUndefined();
    expect(csrfTokenFrom("dsd_customer_csrf=abc", "staff")).toBeUndefined();
  });

  it("treats a missing or empty cookie as no token", () => {
    expect(csrfTokenFrom("", "customer")).toBeUndefined();
    expect(csrfTokenFrom("dsd_customer_csrf=", "customer")).toBeUndefined();
  });
});

describe("csrfMiddleware", () => {
  const run = async (method: string, cookie: string) => {
    const middleware = csrfMiddleware("customer", () => cookie);
    const request = new Request("http://app.test/api/v1/x", { method });
    const result = await middleware.onRequest?.({
      request,
      schemaPath: "/api/v1/x",
      params: {},
      options: {} as never,
      id: "1",
    });
    return (result instanceof Request ? result : request).headers.get(
      "x-csrf-token",
    );
  };

  it("adds the token to state-changing requests", async () => {
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      expect(await run(method, "dsd_customer_csrf=t0k")).toBe("t0k");
    }
  });

  it("leaves safe requests alone", async () => {
    expect(await run("GET", "dsd_customer_csrf=t0k")).toBeNull();
  });

  it("sends nothing when there is no session yet (sign-in, public forms)", async () => {
    expect(await run("POST", "")).toBeNull();
  });
});

describe("ApiProblem", () => {
  const response = (status: number, headers: Record<string, string> = {}) =>
    new Response(null, { status, headers });

  it("keeps the problem's fields, field errors and allowed transitions", () => {
    const problem = ApiProblem.from(response(409), {
      type: "tag:dsd.example,2026:problems/invalid-status-transition",
      title: "Conflict",
      detail: "Can't go there",
      requestId: "req-1",
      allowedTransitions: ["open", "closed", 7],
      errors: [{ path: "subject", message: "Too long" }, { nope: true }],
    });
    expect(problem.status).toBe(409);
    expect(problem.type).toContain("invalid-status-transition");
    expect(problem.message).toBe("Can't go there");
    expect(problem.allowedTransitions).toEqual(["open", "closed"]);
    expect(problem.fieldError("subject")).toBe("Too long");
    expect(problem.fieldError("email")).toBeUndefined();
    expect(problem.requestId).toBe("req-1");
  });

  it("reads Retry-After, and the request ID header when the body has none", () => {
    const problem = ApiProblem.from(
      response(429, { "retry-after": "30", "x-request-id": "req-2" }),
      "not json",
    );
    expect(problem.retryAfterSeconds).toBe(30);
    expect(problem.requestId).toBe("req-2");
    expect(problem.type).toBe("about:blank");
  });
});

describe("ok", () => {
  it("returns the data of a 2xx", async () => {
    await expect(
      ok(
        Promise.resolve({
          data: { a: 1 },
          response: new Response(null, { status: 200 }),
        }),
      ),
    ).resolves.toEqual({ a: 1 });
  });

  it("throws an ApiProblem for anything else", async () => {
    await expect(
      ok(
        Promise.resolve({
          error: { title: "Nope" },
          response: new Response(null, { status: 403 }),
        }),
      ),
    ).rejects.toMatchObject({ status: 403, title: "Nope" });
  });

  it("turns a network failure into status 0", async () => {
    await expect(
      ok(Promise.reject(new TypeError("fetch failed"))),
    ).rejects.toMatchObject({
      status: 0,
    });
  });
});

describe("multipart", () => {
  it("puts every field before the first file and drops empty fields", () => {
    const file = new File(["hi"], "note.txt", { type: "text/plain" });
    const form = multipart(
      { subject: "Help", status: "", email: undefined, body: "x" },
      [file],
    );
    expect([...form.keys()]).toEqual(["subject", "body", "attachments"]);
    expect((form.get("attachments") as File).name).toBe("note.txt");
  });
});
