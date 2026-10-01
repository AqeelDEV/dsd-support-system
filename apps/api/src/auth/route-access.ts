import type { FastifyInstance, RouteOptions } from "fastify";

import { type Access, accessOf } from "./decorators.js";

/** A route as Fastify registered it, with the access its handler declares. */
export interface RegisteredRoute {
  method: string;
  url: string;
  /** Undefined for routes that aren't Nest handlers, such as Swagger UI's. */
  access: Access | undefined;
}

const API_PREFIX = "/api/v1/";
const OPERATIONS = new Set(["/health", "/ready"]);
const DOCS = "/api/docs";

/** Where each kind of route may live (ADR-0003, section 1; ADR-0004). */
const PREFIXES = {
  customer: ["/api/v1/customer/", "/api/v1/auth/customer/"],
  staff: ["/api/v1/staff/", "/api/v1/auth/staff/"],
  public: ["/api/v1/public/", "/api/v1/auth/customer/", "/api/v1/auth/staff/"],
} as const;

const under = (url: string, prefixes: readonly string[]) =>
  prefixes.some((prefix) => url.startsWith(prefix));

/** The CORS plugin's preflight responder; it never reaches a handler. */
const isCorsPreflight = (route: RegisteredRoute) =>
  route.method === "OPTIONS" && route.url === "*";

const isDocs = (route: RegisteredRoute) =>
  (route.url === DOCS || route.url.startsWith(`${DOCS}/`)) &&
  (route.method === "GET" || route.method === "HEAD");

/**
 * Every rule a route must satisfy, as a list of problems (empty when all
 * routes are fine). The API refuses to start with any problem, so an
 * endpoint can't ship without a decision about who may call it.
 */
export function routeAccessProblems(
  routes: readonly RegisteredRoute[],
): string[] {
  const problems: string[] = [];
  for (const route of routes) {
    const name = `${route.method} ${route.url}`;
    if (route.access === undefined) {
      // Only two kinds of route have no Nest handler: Swagger UI's pages and
      // assets, which only serve documentation, and the CORS preflight.
      if (!isDocs(route) && !isCorsPreflight(route)) {
        problems.push(`${name} declares neither @Public() nor @Realm()`);
      }
      continue;
    }
    if (OPERATIONS.has(route.url)) {
      if (route.access.kind !== "public") {
        problems.push(`${name} is for infrastructure and must be @Public()`);
      }
      continue;
    }
    if (!route.url.startsWith(API_PREFIX)) {
      problems.push(`${name} is outside ${API_PREFIX}`);
      continue;
    }
    const allowed =
      route.access.kind === "public"
        ? PREFIXES.public
        : PREFIXES[route.access.realm];
    if (!under(route.url, allowed)) {
      const declared =
        route.access.kind === "public"
          ? "@Public()"
          : `@Realm('${route.access.realm}')`;
      problems.push(
        `${name} is ${declared} but lives outside ${allowed.join(", ")}`,
      );
    }
  }
  return problems;
}

const registries = new WeakMap<FastifyInstance, RegisteredRoute[]>();

function methodsOf(route: RouteOptions): string[] {
  return Array.isArray(route.method) ? route.method : [route.method];
}

/**
 * Records every route registered on `fastify` from now on, and refuses to
 * finish starting if any of them breaks a rule. Call it before anything
 * registers routes, so nothing slips past.
 */
export function enforceRouteAccess(fastify: FastifyInstance): void {
  const routes: RegisteredRoute[] = [];
  registries.set(fastify, routes);
  fastify.addHook("onRoute", (route) => {
    for (const method of methodsOf(route)) {
      routes.push({ method, url: route.url, access: accessOf(route.handler) });
    }
  });
  fastify.addHook("onReady", (done) => {
    const problems = routeAccessProblems(routes);
    done(
      problems.length === 0
        ? undefined
        : new Error(
            `Routes without a valid access rule:\n${problems.map((problem) => `  - ${problem}`).join("\n")}`,
          ),
    );
  });
}

/** Every route registered on `fastify`, for the route-coverage test. */
export function registeredRoutes(
  fastify: FastifyInstance,
): readonly RegisteredRoute[] {
  return registries.get(fastify) ?? [];
}
