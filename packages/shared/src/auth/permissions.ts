import { z } from "zod";

import type { AgentRole } from "../domain/enums.js";

/**
 * Everything a staff member can be allowed to do (ADR-0004, section 1).
 * Code checks these, never role names, so moving a permission between
 * roles is a change to the map below and nothing else.
 */
export const PERMISSIONS = [
  "ticket:read:any",
  "ticket:reply",
  "ticket:note:create",
  "ticket:status:update",
  "ticket:priority:update",
  "ticket:assign",
  "ticket:reassign:any",
  "ticket:escalate",
  "ticket:audit:read",
  "customer:read",
  "kb:read",
  "kb:write",
  "kb:publish",
  "canned:use",
  "canned:manage",
  "report:view",
  "user:read",
  "user:manage",
  "ai:suggestion:read",
  "ai:suggestion:request",
  "ai:suggestion:feedback",
] as const;
export const permissionSchema = z.enum(PERMISSIONS);
export type Permission = z.infer<typeof permissionSchema>;

/** What every agent can do: work tickets, read the knowledge base, use AI drafts. */
const AGENT: readonly Permission[] = [
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
];

/** Agent work plus reassignment, knowledge-base authoring, reporting and people management. */
const SUPERVISOR: readonly Permission[] = [
  ...AGENT,
  "ticket:reassign:any",
  "kb:write",
  "kb:publish",
  "canned:manage",
  "report:view",
  "user:read",
  "user:manage",
];

/**
 * The single place that says what each role can do. Supervisors and admins
 * hold the same permissions; what separates them is rank, which the agent
 * management rules apply (ADR-0004, section 4).
 */
export const ROLE_PERMISSIONS: Readonly<
  Record<AgentRole, readonly Permission[]>
> = {
  agent: AGENT,
  supervisor: SUPERVISOR,
  admin: SUPERVISOR,
};

export function permissionsFor(role: AgentRole): readonly Permission[] {
  return ROLE_PERMISSIONS[role];
}
