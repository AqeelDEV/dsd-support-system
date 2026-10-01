import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { AGENT_ROLES, type AgentRole } from "../domain/enums.js";
import {
  PERMISSIONS,
  permissionsFor,
  ROLE_PERMISSIONS,
} from "./permissions.js";

/**
 * The permission table in ADR-0004 as role to permissions. The ADR is the
 * reviewed statement of who may do what, so the code must match it
 * exactly: any change to the map has to change the ADR too.
 */
function documentedPermissions(): Map<AgentRole, string[]> {
  const adr = readFileSync(
    new URL("../../../../docs/adr/0004-authorization-rbac.md", import.meta.url),
    "utf8",
  );
  const byRole = new Map<AgentRole, string[]>(
    AGENT_ROLES.map((role) => [role, []]),
  );
  for (const line of adr.split("\n")) {
    const cells = line.split("|").map((cell) => cell.trim());
    const permission = /^`([a-z:]+)`$/.exec(cells[1] ?? "")?.[1];
    if (permission === undefined) continue;
    AGENT_ROLES.forEach((role, index) => {
      if (cells[3 + index] === "yes") byRole.get(role)?.push(permission);
    });
  }
  return byRole;
}

describe("permission map (ADR-0004)", () => {
  it.each(AGENT_ROLES)(
    "gives %s exactly the permissions in the ADR",
    (role) => {
      expect([...permissionsFor(role)].sort()).toEqual(
        documentedPermissions().get(role)?.sort(),
      );
    },
  );

  it("names every documented permission and no other", () => {
    const documented = new Set([...documentedPermissions().values()].flat());
    expect([...PERMISSIONS].sort()).toEqual([...documented].sort());
  });

  it("matches the reviewed snapshot", () => {
    expect(ROLE_PERMISSIONS).toMatchInlineSnapshot(`
      {
        "admin": [
          "ticket:read:any",
          "ticket:reply",
          "ticket:note:create",
          "ticket:status:update",
          "ticket:priority:update",
          "ticket:assign",
          "ticket:escalate",
          "ticket:audit:read",
          "customer:read",
          "kb:read",
          "canned:use",
          "ai:suggestion:read",
          "ai:suggestion:request",
          "ai:suggestion:feedback",
          "ticket:reassign:any",
          "kb:write",
          "kb:publish",
          "canned:manage",
          "report:view",
          "user:read",
          "user:manage",
        ],
        "agent": [
          "ticket:read:any",
          "ticket:reply",
          "ticket:note:create",
          "ticket:status:update",
          "ticket:priority:update",
          "ticket:assign",
          "ticket:escalate",
          "ticket:audit:read",
          "customer:read",
          "kb:read",
          "canned:use",
          "ai:suggestion:read",
          "ai:suggestion:request",
          "ai:suggestion:feedback",
        ],
        "supervisor": [
          "ticket:read:any",
          "ticket:reply",
          "ticket:note:create",
          "ticket:status:update",
          "ticket:priority:update",
          "ticket:assign",
          "ticket:escalate",
          "ticket:audit:read",
          "customer:read",
          "kb:read",
          "canned:use",
          "ai:suggestion:read",
          "ai:suggestion:request",
          "ai:suggestion:feedback",
          "ticket:reassign:any",
          "kb:write",
          "kb:publish",
          "canned:manage",
          "report:view",
          "user:read",
          "user:manage",
        ],
      }
    `);
  });

  it("gives every role a permission at most once", () => {
    for (const role of AGENT_ROLES) {
      const granted = permissionsFor(role);
      expect(new Set(granted).size).toBe(granted.length);
    }
  });

  it("never gives an agent supervisor work", () => {
    const agent = new Set(permissionsFor("agent"));
    for (const permission of [
      "ticket:reassign:any",
      "kb:write",
      "kb:publish",
      "canned:manage",
      "report:view",
      "user:read",
      "user:manage",
    ] as const) {
      expect(agent.has(permission)).toBe(false);
    }
  });
});
