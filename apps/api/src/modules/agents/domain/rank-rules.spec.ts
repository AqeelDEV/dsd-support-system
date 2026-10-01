import { AGENT_ROLES, type AgentRole, PROBLEM_TYPES } from "@dsd/shared";
import { describe, expect, it } from "vitest";

import { ProblemException } from "../../../common/problem-details.js";
import {
  allowedAgentActions,
  assertCanInvite,
  assertCanResendInvite,
  canManage,
  type Colleague,
  decideDeactivation,
  decideReactivation,
  decideRoleChange,
  grantableRoles,
  type Manager,
} from "./rank-rules.js";

const manager = (role: AgentRole, active = true): Manager => ({
  id: "manager",
  role,
  active,
});
const colleague = (
  role: AgentRole,
  overrides: Partial<Colleague> = {},
): Colleague => ({
  id: "colleague",
  role,
  active: true,
  hasPassword: true,
  ...overrides,
});

/** The status and problem type a rule throws, or what it returned. */
function outcome(run: () => unknown): unknown {
  try {
    return run();
  } catch (error) {
    if (error instanceof ProblemException) {
      return { status: error.getStatus(), type: error.problemType };
    }
    throw error;
  }
}

const FORBIDDEN = { status: 403, type: PROBLEM_TYPES.blank };
const LAST_ADMIN = { status: 409, type: PROBLEM_TYPES.lastAdmin };

describe("who may manage whom", () => {
  // [manager, colleague, may manage]
  it.each([
    ["agent", "agent", false],
    ["agent", "supervisor", false],
    ["agent", "admin", false],
    ["supervisor", "agent", true],
    ["supervisor", "supervisor", false],
    ["supervisor", "admin", false],
    ["admin", "agent", true],
    ["admin", "supervisor", true],
    ["admin", "admin", true],
  ] as const)("a %s managing a %s: %s", (managerRole, colleagueRole, may) => {
    expect(canManage(manager(managerRole), colleague(colleagueRole))).toBe(may);
  });

  it.each(AGENT_ROLES)("a %s can never manage themselves", (role) => {
    const self = manager(role);
    expect(canManage(self, { ...colleague(role), id: self.id })).toBe(false);
    expect(
      outcome(() =>
        decideRoleChange(self, { ...colleague(role), id: self.id }, "agent", 5),
      ),
    ).toEqual(FORBIDDEN);
  });

  it("a deactivated manager manages nobody", () => {
    expect(canManage(manager("admin", false), colleague("agent"))).toBe(false);
    expect(grantableRoles(manager("admin", false))).toEqual([]);
  });
});

describe("granting roles", () => {
  it.each([
    ["agent", []],
    ["supervisor", ["agent", "supervisor"]],
    ["admin", ["agent", "supervisor", "admin"]],
  ] as const)("a %s may grant %j", (role, roles) => {
    expect(grantableRoles(manager(role))).toEqual(roles);
  });

  // [manager, colleague, new role, outcome]
  it.each([
    ["supervisor", "agent", "supervisor", "supervisor"],
    ["supervisor", "agent", "admin", FORBIDDEN],
    ["supervisor", "agent", "agent", "unchanged"],
    ["supervisor", "supervisor", "agent", FORBIDDEN],
    ["supervisor", "admin", "agent", FORBIDDEN],
    ["admin", "agent", "admin", "admin"],
    ["admin", "supervisor", "agent", "agent"],
    ["admin", "admin", "supervisor", "supervisor"],
    ["agent", "agent", "supervisor", FORBIDDEN],
  ] as const)(
    "a %s changing a %s to %s gives %j",
    (managerRole, colleagueRole, role, expected) => {
      expect(
        outcome(() =>
          decideRoleChange(
            manager(managerRole),
            colleague(colleagueRole),
            role,
            1,
          ),
        ),
      ).toEqual(expected);
    },
  );

  it("refuses to demote the last active admin", () => {
    expect(
      outcome(() =>
        decideRoleChange(manager("admin"), colleague("admin"), "agent", 0),
      ),
    ).toEqual(LAST_ADMIN);
    expect(
      decideRoleChange(manager("admin"), colleague("admin"), "agent", 1),
    ).toBe("agent");
  });

  it("lets a deactivated admin be demoted whatever the count", () => {
    expect(
      decideRoleChange(
        manager("admin"),
        colleague("admin", { active: false }),
        "agent",
        0,
      ),
    ).toBe("agent");
  });

  it.each([
    ["supervisor", "supervisor", "ok"],
    ["supervisor", "admin", FORBIDDEN],
    ["admin", "admin", "ok"],
    ["agent", "agent", FORBIDDEN],
  ] as const)("a %s inviting a %s: %j", (managerRole, role, expected) => {
    expect(
      outcome(() => {
        assertCanInvite(manager(managerRole), role);
        return "ok";
      }),
    ).toEqual(expected);
  });
});

describe("deactivating and reactivating", () => {
  it("deactivates an active colleague ranked below", () => {
    expect(
      decideDeactivation(manager("supervisor"), colleague("agent"), 1),
    ).toBe("deactivate");
  });

  it("is a no-op for someone already deactivated", () => {
    expect(
      decideDeactivation(
        manager("supervisor"),
        colleague("agent", { active: false }),
        1,
      ),
    ).toBe("unchanged");
  });

  it("refuses a colleague of equal or higher rank before anything else", () => {
    expect(
      outcome(() =>
        decideDeactivation(
          manager("supervisor"),
          colleague("supervisor", { active: false }),
          1,
        ),
      ),
    ).toEqual(FORBIDDEN);
  });

  it("refuses to deactivate the last active admin", () => {
    expect(
      outcome(() =>
        decideDeactivation(manager("admin"), colleague("admin"), 0),
      ),
    ).toEqual(LAST_ADMIN);
  });

  it("reactivates, and is a no-op for someone already active", () => {
    const inactive = colleague("agent", { active: false });
    expect(decideReactivation(manager("supervisor"), inactive)).toBe(
      "reactivate",
    );
    expect(decideReactivation(manager("supervisor"), colleague("agent"))).toBe(
      "unchanged",
    );
    expect(
      outcome(() => decideReactivation(manager("agent"), inactive)),
    ).toEqual(FORBIDDEN);
  });
});

describe("sending an invite again", () => {
  it("works for an active colleague without a password", () => {
    expect(
      outcome(() => {
        assertCanResendInvite(
          manager("supervisor"),
          colleague("agent", { hasPassword: false }),
        );
        return "ok";
      }),
    ).toBe("ok");
  });

  it.each([
    ["has a password", { hasPassword: true }],
    ["is deactivated", { hasPassword: false, active: false }],
  ] as const)("is a 409 when the colleague %s", (_name, overrides) => {
    expect(
      outcome(() => {
        assertCanResendInvite(
          manager("supervisor"),
          colleague("agent", overrides),
        );
      }),
    ).toEqual({ status: 409, type: PROBLEM_TYPES.blank });
  });
});

describe("allowedAgentActions", () => {
  it("offers what the rules allow for an invited agent", () => {
    expect(
      allowedAgentActions(
        manager("supervisor"),
        colleague("agent", { hasPassword: false }),
      ),
    ).toEqual({
      edit: true,
      changeRole: true,
      deactivate: true,
      reactivate: false,
      resendInvite: true,
    });
  });

  it("offers reactivation for a deactivated agent", () => {
    expect(
      allowedAgentActions(
        manager("admin"),
        colleague("agent", { active: false }),
      ),
    ).toMatchObject({
      deactivate: false,
      reactivate: true,
      resendInvite: false,
    });
  });

  it("offers nothing for a colleague of the same rank, below admin", () => {
    expect(
      Object.values(
        allowedAgentActions(manager("supervisor"), colleague("supervisor")),
      ),
    ).toEqual([false, false, false, false, false]);
  });
});
