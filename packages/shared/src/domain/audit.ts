import { z } from "zod";

/**
 * Every action recorded in `audit_events.action` (ADR-0008, section 3).
 * The column is text rather than a Postgres enum, so adding an action
 * doesn't need a migration; this list is what the API validates against.
 */
export const AUDIT_ACTIONS = [
  "ticket.created",
  "ticket.status_changed",
  "ticket.priority_changed",
  "ticket.assigned",
  "ticket.escalated",
  "message.created",
  "attachment.created",
  "ai_suggestion.used",
  "agent.invited",
  "agent.role_changed",
  "agent.deactivated",
  "agent.reactivated",
  "kb.article_published",
  "kb.article_unpublished",
  "kb.article_archived",
] as const;
export const auditActionSchema = z.enum(AUDIT_ACTIONS);
export type AuditAction = z.infer<typeof auditActionSchema>;
