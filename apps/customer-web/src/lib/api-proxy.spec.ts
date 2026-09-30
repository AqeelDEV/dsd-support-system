import { describe, expect, it } from "vitest";

import { apiProxy } from "./api-proxy";

describe("customer app API proxy", () => {
  it.each([
    "/api/v1/staff/tickets",
    "/api/v1/auth/staff/login",
    "/api/v1/customer/../staff/tickets",
  ])("refuses the staff route %s", async (path) => {
    const response = await apiProxy(
      new Request(`http://localhost:3000${path}`),
    );
    expect(response.status).toBe(404);
    expect(response.headers.get("content-type")).toBe(
      "application/problem+json",
    );
  });
});
