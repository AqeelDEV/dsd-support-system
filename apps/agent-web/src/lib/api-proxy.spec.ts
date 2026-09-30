import { describe, expect, it } from "vitest";

import { apiProxy } from "./api-proxy";

describe("agent app API proxy", () => {
  it.each([
    "/api/v1/customer/tickets",
    "/api/v1/auth/customer/login",
    "/api/v1/public/tickets",
    "/api/v1/staff/../customer/tickets",
  ])("refuses the non-staff route %s", async (path) => {
    const response = await apiProxy(
      new Request(`http://localhost:3001${path}`),
    );
    expect(response.status).toBe(404);
    expect(response.headers.get("content-type")).toBe(
      "application/problem+json",
    );
  });
});
