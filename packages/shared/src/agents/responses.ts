import { z } from "zod";

import { agentRoleSchema } from "../domain/enums.js";
import { agentStatusSchema } from "./requests.js";

const timestamp = z.iso.datetime();

/**
 * What the agent app may offer for this colleague (ADR-0004, section 5).
 * The API applies the same rank rules whatever the app shows.
 */
export const agentAllowedActionsSchema = z.object({
  edit: z.boolean(),
  changeRole: z.boolean(),
  deactivate: z.boolean(),
  reactivate: z.boolean(),
  resendInvite: z.boolean(),
});

export const agentSchema = z.object({
  id: z.uuid(),
  email: z.string(),
  displayName: z.string(),
  role: agentRoleSchema,
  status: agentStatusSchema.describe(
    "`invited` until they set a password from the emailed invite",
  ),
  brands: z.array(
    z.object({ id: z.uuid(), slug: z.string(), name: z.string() }),
  ),
  lastLoginAt: timestamp.nullable(),
  deactivatedAt: timestamp.nullable(),
  createdAt: timestamp,
  allowedActions: agentAllowedActionsSchema,
  grantableRoles: z
    .array(agentRoleSchema)
    .describe("The roles you may give this colleague now; empty if none"),
});

/**
 * A colleague a ticket can be handed to: active, sharing a brand with you.
 * Names and roles only, so any agent can fill an "Assign to" or "Escalate
 * to" picker without `user:read` (FR-11).
 */
export const assignableAgentSchema = z.object({
  id: z.uuid(),
  displayName: z.string(),
  role: agentRoleSchema,
});

export const assignableAgentsSchema = z.object({
  items: z.array(assignableAgentSchema).describe("Ordered by name"),
});

export type AssignableAgent = z.infer<typeof assignableAgentSchema>;
export type AgentAllowedActions = z.infer<typeof agentAllowedActionsSchema>;
export type Agent = z.infer<typeof agentSchema>;
