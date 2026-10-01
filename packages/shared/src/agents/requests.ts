import { z } from "zod";

import { emailSchema } from "../auth/schemas.js";
import { agentRoleSchema } from "../domain/enums.js";
import { pageFields, text } from "../http/fields.js";

/*
 * Agent management requests (FR-14; ADR-0004, section 4). Who may do what
 * to whom is decided by the rank rules in the API; these only say what a
 * well-formed request looks like.
 */

const displayName = text(100).describe("How colleagues and customers see them");

export const agentInviteRequestSchema = z.strictObject({
  email: emailSchema,
  displayName,
  role: agentRoleSchema.describe(
    "Up to and including your own rank: only an admin can invite an admin",
  ),
});

export const agentUpdateRequestSchema = z.strictObject({ displayName });

export const agentRoleChangeRequestSchema = z.strictObject({
  role: agentRoleSchema,
});

export const AGENT_STATUSES = ["active", "invited", "deactivated"] as const;
export const agentStatusSchema = z.enum(AGENT_STATUSES);
export type AgentStatus = z.infer<typeof agentStatusSchema>;

export const agentListQuerySchema = z.strictObject({
  status: agentStatusSchema
    .optional()
    .describe(
      "`active`, `invited` (no password yet) or `deactivated`; all by default",
    ),
  role: agentRoleSchema.optional(),
  ...pageFields,
});

export type AgentInviteRequest = z.infer<typeof agentInviteRequestSchema>;
export type AgentUpdateRequest = z.infer<typeof agentUpdateRequestSchema>;
export type AgentRoleChangeRequest = z.infer<
  typeof agentRoleChangeRequestSchema
>;
export type AgentListQuery = z.infer<typeof agentListQuerySchema>;
