import { describe, expect, it } from "vitest";

import { accessOf, Public, Realm } from "./decorators.js";
import { type RegisteredRoute, routeAccessProblems } from "./route-access.js";

const customer = { kind: "realm", realm: "customer" } as const;
const staff = { kind: "realm", realm: "staff" } as const;
const open = { kind: "public" } as const;

const route = (
  method: string,
  url: string,
  access: RegisteredRoute["access"],
): RegisteredRoute => ({ method, url, access });

describe("routeAccessProblems", () => {
  it("accepts every route that sits where its access says", () => {
    expect(
      routeAccessProblems([
        route("GET", "/health", open),
        route("GET", "/ready", open),
        route("POST", "/api/v1/auth/customer/login", open),
        route("POST", "/api/v1/auth/staff/login", open),
        route("GET", "/api/v1/public/kb/articles", open),
        route("GET", "/api/v1/auth/customer/me", customer),
        route("GET", "/api/v1/customer/tickets", customer),
        route("GET", "/api/v1/auth/staff/me", staff),
        route("GET", "/api/v1/staff/tickets", staff),
        route("GET", "/api/docs", undefined),
        route("GET", "/api/docs/openapi.json", undefined),
        route("HEAD", "/api/docs/swagger-ui.css", undefined),
        route("OPTIONS", "*", undefined),
      ]),
    ).toEqual([]);
  });

  it("refuses a route that declares no access", () => {
    expect(
      routeAccessProblems([route("GET", "/api/v1/staff/tickets", undefined)]),
    ).toEqual([
      "GET /api/v1/staff/tickets declares neither @Public() nor @Realm()",
    ]);
  });

  it("refuses anything but reads from the documentation routes", () => {
    expect(
      routeAccessProblems([route("POST", "/api/docs/upload", undefined)]),
    ).toHaveLength(1);
  });

  it.each([
    [
      "a staff route under the customer prefix",
      route("GET", "/api/v1/customer/tickets", staff),
    ],
    [
      "a customer route under the staff prefix",
      route("GET", "/api/v1/staff/tickets", customer),
    ],
    [
      "a customer route under staff sign-in",
      route("GET", "/api/v1/auth/staff/me", customer),
    ],
    [
      "a public route under the staff prefix",
      route("GET", "/api/v1/staff/tickets", open),
    ],
    [
      "a public route under the customer prefix",
      route("GET", "/api/v1/customer/tickets", open),
    ],
    [
      "a route outside every realm prefix",
      route("GET", "/api/v1/tickets", customer),
    ],
  ])("refuses %s", (_, wrong) => {
    expect(routeAccessProblems([wrong])).toEqual([
      expect.stringContaining("lives outside"),
    ]);
  });

  it("refuses a route outside /api/v1", () => {
    expect(routeAccessProblems([route("GET", "/tickets", open)])).toEqual([
      "GET /tickets is outside /api/v1/",
    ]);
  });

  it("refuses health checks that need a session", () => {
    expect(routeAccessProblems([route("GET", "/ready", staff)])).toEqual([
      "GET /ready is for infrastructure and must be @Public()",
    ]);
  });
});

describe("access decorators", () => {
  @Realm("customer")
  class Controller {
    @Public()
    login() {
      return "public";
    }

    me() {
      return "customer";
    }

    @Realm("staff")
    odd() {
      return "staff";
    }
  }
  /** The handler as Nest sees it: the function on the prototype. */
  const handler = (target: { prototype: object }, name: string) =>
    Reflect.get(target.prototype, name) as object;

  it("put a class's realm on every handler without its own", () => {
    expect(accessOf(handler(Controller, "me"))).toEqual(customer);
  });

  it("let a handler's own declaration win", () => {
    expect(accessOf(handler(Controller, "login"))).toEqual(open);
    expect(accessOf(handler(Controller, "odd"))).toEqual(staff);
  });

  it("leave an undecorated handler without access", () => {
    class Bare {
      handler() {
        return undefined;
      }
    }
    expect(accessOf(handler(Bare, "handler"))).toBeUndefined();
  });
});
