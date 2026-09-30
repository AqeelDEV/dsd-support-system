import { z } from "zod";

/*
 * The closed sets that the state machine and the permission rules depend
 * on. The database declares each as a Postgres enum from these same arrays
 * (docs/DATA_MODEL.md, "Enums"), so a value can't exist in one place and
 * not the other.
 */

/** Lifecycle statuses (ADR-0007). */
export const TICKET_STATUSES = [
  "open",
  "pending_customer",
  "resolved",
  "closed",
] as const;
export const ticketStatusSchema = z.enum(TICKET_STATUSES);
export type TicketStatus = z.infer<typeof ticketStatusSchema>;

/** Declared from least to most urgent, so `ORDER BY priority DESC` puts urgent first. */
export const TICKET_PRIORITIES = ["low", "normal", "high", "urgent"] as const;
export const ticketPrioritySchema = z.enum(TICKET_PRIORITIES);
export type TicketPriority = z.infer<typeof ticketPrioritySchema>;

/** How a ticket arrived. Only `web` is used in v1; the rest are reserved (FR-6). */
export const TICKET_CHANNELS = ["web", "email", "chat", "whatsapp"] as const;
export const ticketChannelSchema = z.enum(TICKET_CHANNELS);
export type TicketChannel = z.infer<typeof ticketChannelSchema>;

/** Staff roles, lowest rank first (ADR-0004). */
export const AGENT_ROLES = ["agent", "supervisor", "admin"] as const;
export const agentRoleSchema = z.enum(AGENT_ROLES);
export type AgentRole = z.infer<typeof agentRoleSchema>;

export const SESSION_REALMS = ["customer", "staff"] as const;
export const sessionRealmSchema = z.enum(SESSION_REALMS);
export type SessionRealm = z.infer<typeof sessionRealmSchema>;

export const AUTH_TOKEN_PURPOSES = [
  "guest_ticket_access",
  "customer_signup",
  "agent_invite",
  "password_reset",
] as const;
export const authTokenPurposeSchema = z.enum(AUTH_TOKEN_PURPOSES);
export type AuthTokenPurpose = z.infer<typeof authTokenPurposeSchema>;

/** Who wrote a message or uploaded an attachment. */
export const PARTICIPANT_TYPES = ["customer", "agent"] as const;
export const participantTypeSchema = z.enum(PARTICIPANT_TYPES);
export type ParticipantType = z.infer<typeof participantTypeSchema>;

/** Who caused an audit event. */
export const ACTOR_TYPES = ["customer", "agent", "system"] as const;
export const actorTypeSchema = z.enum(ACTOR_TYPES);
export type ActorType = z.infer<typeof actorTypeSchema>;

/** `internal` marks an internal note, which customers never see (FR-10). */
export const MESSAGE_VISIBILITIES = ["public", "internal"] as const;
export const messageVisibilitySchema = z.enum(MESSAGE_VISIBILITIES);
export type MessageVisibility = z.infer<typeof messageVisibilitySchema>;

export const KB_ARTICLE_STATUSES = ["draft", "published", "archived"] as const;
export const kbArticleStatusSchema = z.enum(KB_ARTICLE_STATUSES);
export type KbArticleStatus = z.infer<typeof kbArticleStatusSchema>;

/** Only reply drafts in v1; triage and sentiment are expected later (FR-23). */
export const AI_SUGGESTION_KINDS = ["reply_draft"] as const;
export const aiSuggestionKindSchema = z.enum(AI_SUGGESTION_KINDS);
export type AiSuggestionKind = z.infer<typeof aiSuggestionKindSchema>;

export const AI_SUGGESTION_STATUSES = [
  "pending",
  "ready",
  "no_grounded_answer",
  "rejected",
  "failed",
] as const;
export const aiSuggestionStatusSchema = z.enum(AI_SUGGESTION_STATUSES);
export type AiSuggestionStatus = z.infer<typeof aiSuggestionStatusSchema>;

export const FEEDBACK_RATINGS = ["up", "down"] as const;
export const feedbackRatingSchema = z.enum(FEEDBACK_RATINGS);
export type FeedbackRating = z.infer<typeof feedbackRatingSchema>;

/** Only email in v1; SMS and WhatsApp are added with their adapters (FR-20). */
export const NOTIFICATION_CHANNELS = ["email"] as const;
export const notificationChannelSchema = z.enum(NOTIFICATION_CHANNELS);
export type NotificationChannel = z.infer<typeof notificationChannelSchema>;

export const NOTIFICATION_STATUSES = ["pending", "sent", "failed"] as const;
export const notificationStatusSchema = z.enum(NOTIFICATION_STATUSES);
export type NotificationStatus = z.infer<typeof notificationStatusSchema>;
