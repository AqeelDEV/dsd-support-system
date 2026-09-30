import {
  ACTOR_TYPES,
  AGENT_ROLES,
  AI_SUGGESTION_KINDS,
  AI_SUGGESTION_STATUSES,
  AUTH_TOKEN_PURPOSES,
  FEEDBACK_RATINGS,
  KB_ARTICLE_STATUSES,
  MESSAGE_VISIBILITIES,
  NOTIFICATION_CHANNELS,
  NOTIFICATION_STATUSES,
  PARTICIPANT_TYPES,
  SESSION_REALMS,
  TICKET_CHANNELS,
  TICKET_PRIORITIES,
  TICKET_STATUSES,
} from "@dsd/shared";
import { pgEnum } from "drizzle-orm/pg-core";

// Built from the arrays in @dsd/shared, so the database and the API
// schemas can't disagree about a value.
export const ticketStatus = pgEnum("ticket_status", TICKET_STATUSES);
export const ticketPriority = pgEnum("ticket_priority", TICKET_PRIORITIES);
export const ticketChannel = pgEnum("ticket_channel", TICKET_CHANNELS);
export const agentRole = pgEnum("agent_role", AGENT_ROLES);
export const sessionRealm = pgEnum("session_realm", SESSION_REALMS);
export const authTokenPurpose = pgEnum(
  "auth_token_purpose",
  AUTH_TOKEN_PURPOSES,
);
export const participantType = pgEnum("participant_type", PARTICIPANT_TYPES);
export const actorType = pgEnum("actor_type", ACTOR_TYPES);
export const messageVisibility = pgEnum(
  "message_visibility",
  MESSAGE_VISIBILITIES,
);
export const kbArticleStatus = pgEnum("kb_article_status", KB_ARTICLE_STATUSES);
export const aiSuggestionKind = pgEnum(
  "ai_suggestion_kind",
  AI_SUGGESTION_KINDS,
);
export const aiSuggestionStatus = pgEnum(
  "ai_suggestion_status",
  AI_SUGGESTION_STATUSES,
);
export const feedbackRating = pgEnum("feedback_rating", FEEDBACK_RATINGS);
export const notificationChannel = pgEnum(
  "notification_channel",
  NOTIFICATION_CHANNELS,
);
export const notificationStatus = pgEnum(
  "notification_status",
  NOTIFICATION_STATUSES,
);
