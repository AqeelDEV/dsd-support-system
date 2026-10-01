import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  type RegisteredRoute,
  registeredRoutes,
  routeAccessProblems,
} from "../../src/auth/route-access.js";
import { startApp } from "../support/app.js";
import { MATRIX } from "./matrix.js";

const isDocs = (route: RegisteredRoute) => route.url.startsWith("/api/docs");
const isCorsPreflight = (route: RegisteredRoute) =>
  route.method === "OPTIONS" && route.url === "*";

/**
 * Route coverage (ADR-0004, Verification): every route the running API
 * registers must have a row in the RBAC matrix, and every row must still
 * match a route. A new endpoint without a decision about who may call it
 * fails here.
 */
describe("route coverage", () => {
  let app: NestFastifyApplication;
  let routes: readonly RegisteredRoute[];

  beforeAll(async () => {
    // The matrix needs a database; this test only needs the routes.
    app = await startApp();
    routes = registeredRoutes(app.getHttpAdapter().getInstance());
  });

  afterAll(async () => {
    await app.close();
  });

  /**
   * The API's own routes. Fastify adds a HEAD route for every GET; it runs
   * the same handler and guards, so the GET row covers it.
   */
  const apiRoutes = () =>
    routes.filter(
      (route) =>
        !isDocs(route) && !isCorsPreflight(route) && route.method !== "HEAD",
    );

  it("finds the routes it is checking", () => {
    expect(apiRoutes().length).toBeGreaterThanOrEqual(MATRIX.length);
  });

  it("has a matrix row for every registered route", () => {
    const covered = new Set(MATRIX.map((row) => `${row.method} ${row.path}`));
    const missing = apiRoutes()
      .map((route) => `${route.method} ${route.url}`)
      .filter((route) => !covered.has(route));
    expect(missing).toEqual([]);
  });

  it("has no matrix row for a route that no longer exists", () => {
    const registered = new Set(
      apiRoutes().map((route) => `${route.method} ${route.url}`),
    );
    const stale = MATRIX.map((row) => `${row.method} ${row.path}`).filter(
      (row) => !registered.has(row),
    );
    expect(stale).toEqual([]);
  });

  it("finds every route declaring a realm or @Public(), in the right place", () => {
    expect(routeAccessProblems(routes)).toEqual([]);
    for (const route of apiRoutes()) {
      expect(route.access, `${route.method} ${route.url}`).toBeDefined();
    }
  });

  it("keeps everything but health checks and documentation under /api/v1 (API-2)", () => {
    const outside = apiRoutes()
      .map((route) => route.url)
      .filter(
        (url) =>
          !url.startsWith("/api/v1/") && url !== "/health" && url !== "/ready",
      );
    expect(outside).toEqual([]);
  });

  it("serves documentation only through GET and HEAD", () => {
    const writable = routes.filter(
      (route) => isDocs(route) && !["GET", "HEAD"].includes(route.method),
    );
    expect(writable).toEqual([]);
  });
});
