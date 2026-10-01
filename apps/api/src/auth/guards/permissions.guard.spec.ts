import { type ExecutionContext, ForbiddenException } from "@nestjs/common";
import { type AgentRole, permissionsFor } from "@dsd/shared";
import type { FastifyRequest } from "fastify";
import { describe, expect, it } from "vitest";

import { RequirePermissions } from "../decorators.js";
import type { Principal } from "../principal.js";
import { PermissionsGuard } from "./permissions.guard.js";

class Routes {
  @RequirePermissions("ticket:reply")
  reply() {
    return undefined;
  }

  @RequirePermissions("report:view", "user:read")
  dashboard() {
    return undefined;
  }

  me() {
    return undefined;
  }
}

const staff = (role: AgentRole): Principal => ({
  realm: "staff",
  sessionId: "s",
  agent: { id: "a", email: "a@dsd.example", displayName: "A", role },
  permissions: new Set(permissionsFor(role)),
});

const customer: Principal = {
  realm: "customer",
  sessionId: "s",
  customer: { id: "c", email: "c@example.com", displayName: null },
  guestTicketId: null,
};

const guard = new PermissionsGuard();

function allowed(handler: keyof Routes, principal?: Principal): boolean {
  const request = { principal } as FastifyRequest;
  const context = {
    getHandler: () => Reflect.get(Routes.prototype, handler) as object,
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
  try {
    return guard.canActivate(context);
  } catch (error) {
    if (error instanceof ForbiddenException) return false;
    throw error;
  }
}

describe("PermissionsGuard", () => {
  it("lets through routes that require nothing", () => {
    expect(allowed("me", staff("agent"))).toBe(true);
  });

  it.each(["agent", "supervisor", "admin"] as const)(
    "lets a %s reply to tickets",
    (role) => {
      expect(allowed("reply", staff(role))).toBe(true);
    },
  );

  it("needs every listed permission, not just one", () => {
    expect(allowed("dashboard", staff("agent"))).toBe(false);
    expect(allowed("dashboard", staff("supervisor"))).toBe(true);
  });

  it("refuses a customer session outright", () => {
    expect(allowed("reply", customer)).toBe(false);
  });

  it("refuses a request without a session", () => {
    expect(allowed("reply")).toBe(false);
  });
});
