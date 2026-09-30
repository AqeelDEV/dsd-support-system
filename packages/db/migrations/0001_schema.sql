CREATE TYPE "public"."actor_type" AS ENUM('customer', 'agent', 'system');--> statement-breakpoint
CREATE TYPE "public"."agent_role" AS ENUM('agent', 'supervisor', 'admin');--> statement-breakpoint
CREATE TYPE "public"."ai_suggestion_kind" AS ENUM('reply_draft');--> statement-breakpoint
CREATE TYPE "public"."ai_suggestion_status" AS ENUM('pending', 'ready', 'no_grounded_answer', 'rejected', 'failed');--> statement-breakpoint
CREATE TYPE "public"."auth_token_purpose" AS ENUM('guest_ticket_access', 'customer_signup', 'agent_invite', 'password_reset');--> statement-breakpoint
CREATE TYPE "public"."feedback_rating" AS ENUM('up', 'down');--> statement-breakpoint
CREATE TYPE "public"."kb_article_status" AS ENUM('draft', 'published', 'archived');--> statement-breakpoint
CREATE TYPE "public"."message_visibility" AS ENUM('public', 'internal');--> statement-breakpoint
CREATE TYPE "public"."notification_channel" AS ENUM('email');--> statement-breakpoint
CREATE TYPE "public"."notification_status" AS ENUM('pending', 'sent', 'failed');--> statement-breakpoint
CREATE TYPE "public"."participant_type" AS ENUM('customer', 'agent');--> statement-breakpoint
CREATE TYPE "public"."session_realm" AS ENUM('customer', 'staff');--> statement-breakpoint
CREATE TYPE "public"."ticket_channel" AS ENUM('web', 'email', 'chat', 'whatsapp');--> statement-breakpoint
CREATE TYPE "public"."ticket_priority" AS ENUM('low', 'normal', 'high', 'urgent');--> statement-breakpoint
CREATE TYPE "public"."ticket_status" AS ENUM('open', 'pending_customer', 'resolved', 'closed');--> statement-breakpoint
CREATE SEQUENCE "public"."ticket_number_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1;--> statement-breakpoint
CREATE TABLE "ai_suggestion_feedback" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"suggestion_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"rating" "feedback_rating" NOT NULL,
	"comment" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_suggestion_feedback_agent_key" UNIQUE("suggestion_id","agent_id")
);
--> statement-breakpoint
CREATE TABLE "ai_suggestion_sources" (
	"suggestion_id" uuid NOT NULL,
	"chunk_id" uuid NOT NULL,
	"rank" integer NOT NULL,
	"vector_score" real,
	"fts_score" real,
	"fused_score" real NOT NULL,
	"cited" boolean DEFAULT false NOT NULL,
	CONSTRAINT "ai_suggestion_sources_suggestion_id_chunk_id_pk" PRIMARY KEY("suggestion_id","chunk_id")
);
--> statement-breakpoint
CREATE TABLE "ai_suggestions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"ticket_id" uuid NOT NULL,
	"kind" "ai_suggestion_kind" DEFAULT 'reply_draft' NOT NULL,
	"status" "ai_suggestion_status" DEFAULT 'pending' NOT NULL,
	"trigger_event_id" uuid NOT NULL,
	"requested_by_agent_id" uuid,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"prompt_version" text NOT NULL,
	"retrieval_mode" text NOT NULL,
	"top_vector_score" real,
	"top_fts_score" real,
	"draft_body" text,
	"output" jsonb,
	"rejection_reason" text,
	"error" text,
	"latency_ms" integer,
	"input_tokens" integer,
	"output_tokens" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "ai_suggestions_id_ticket_key" UNIQUE("id","ticket_id"),
	CONSTRAINT "ai_suggestions_ticket_trigger_key" UNIQUE("ticket_id","trigger_event_id"),
	CONSTRAINT "ai_suggestions_ready_ck" CHECK ("ai_suggestions"."status" <> 'ready' OR "ai_suggestions"."draft_body" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "audit_events" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"ticket_id" uuid,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"action" text NOT NULL,
	"actor_type" "actor_type" NOT NULL,
	"actor_customer_id" uuid,
	"actor_agent_id" uuid,
	"before" jsonb,
	"after" jsonb,
	"request_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "audit_events_actor_ck" CHECK (("audit_events"."actor_type" = 'system' AND "audit_events"."actor_customer_id" IS NULL AND "audit_events"."actor_agent_id" IS NULL) OR ("audit_events"."actor_type" = 'customer' AND "audit_events"."actor_customer_id" IS NOT NULL AND "audit_events"."actor_agent_id" IS NULL) OR ("audit_events"."actor_type" = 'agent' AND "audit_events"."actor_agent_id" IS NOT NULL AND "audit_events"."actor_customer_id" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "brands" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"ticket_prefix" text NOT NULL,
	"support_email" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "brands_slug_key" UNIQUE("slug"),
	CONSTRAINT "brands_ticket_prefix_key" UNIQUE("ticket_prefix"),
	CONSTRAINT "brands_ticket_prefix_ck" CHECK ("brands"."ticket_prefix" ~ '^[A-Z]{2,8}$')
);
--> statement-breakpoint
CREATE TABLE "canned_responses" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"brand_id" uuid NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"created_by_agent_id" uuid NOT NULL,
	"updated_by_agent_id" uuid NOT NULL,
	"retired_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_brand_memberships" (
	"agent_id" uuid NOT NULL,
	"brand_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_brand_memberships_agent_id_brand_id_pk" PRIMARY KEY("agent_id","brand_id")
);
--> statement-breakpoint
CREATE TABLE "agents" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"email" text NOT NULL,
	"email_normalized" text NOT NULL,
	"display_name" text NOT NULL,
	"role" "agent_role" NOT NULL,
	"password_hash" text,
	"invited_by_agent_id" uuid,
	"deactivated_at" timestamp with time zone,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agents_email_normalized_key" UNIQUE("email_normalized")
);
--> statement-breakpoint
CREATE TABLE "customers" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"email" text NOT NULL,
	"email_normalized" text NOT NULL,
	"display_name" text,
	"password_hash" text,
	"email_verified_at" timestamp with time zone,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customers_email_normalized_key" UNIQUE("email_normalized"),
	CONSTRAINT "customers_password_needs_verified_ck" CHECK ("customers"."password_hash" IS NULL OR "customers"."email_verified_at" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "kb_articles" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"brand_id" uuid NOT NULL,
	"category_id" uuid,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"summary" text DEFAULT '' NOT NULL,
	"body_markdown" text NOT NULL,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"status" "kb_article_status" DEFAULT 'draft' NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"published_at" timestamp with time zone,
	"search_vector" "tsvector" GENERATED ALWAYS AS (setweight(to_tsvector('english', title), 'A') || setweight(to_tsvector('english', summary), 'B') || setweight(to_tsvector('english', body_markdown), 'C')) STORED,
	"author_agent_id" uuid NOT NULL,
	"updated_by_agent_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "kb_articles_brand_slug_key" UNIQUE("brand_id","slug"),
	CONSTRAINT "kb_articles_published_ck" CHECK ("kb_articles"."status" <> 'published' OR "kb_articles"."published_at" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "kb_categories" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"brand_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "kb_categories_brand_slug_key" UNIQUE("brand_id","slug")
);
--> statement-breakpoint
CREATE TABLE "kb_chunks" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"article_id" uuid NOT NULL,
	"article_version" integer NOT NULL,
	"chunk_index" integer NOT NULL,
	"heading_path" text DEFAULT '' NOT NULL,
	"content" text NOT NULL,
	"token_count" integer NOT NULL,
	"search_vector" "tsvector" GENERATED ALWAYS AS (setweight(to_tsvector('english', heading_path), 'A') || setweight(to_tsvector('english', content), 'B')) STORED,
	"embedding" vector(1024),
	"embedding_model" text,
	"is_current" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "kb_chunks_article_version_index_key" UNIQUE("article_id","article_version","chunk_index")
);
--> statement-breakpoint
CREATE TABLE "attachments" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"ticket_id" uuid NOT NULL,
	"message_id" uuid,
	"uploader_type" "participant_type" NOT NULL,
	"uploader_customer_id" uuid,
	"uploader_agent_id" uuid,
	"object_key" text NOT NULL,
	"filename" text NOT NULL,
	"content_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"sha256" "bytea" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "attachments_object_key_key" UNIQUE("object_key"),
	CONSTRAINT "attachments_uploader_ck" CHECK (("attachments"."uploader_type" = 'customer' AND "attachments"."uploader_customer_id" IS NOT NULL AND "attachments"."uploader_agent_id" IS NULL) OR ("attachments"."uploader_type" = 'agent' AND "attachments"."uploader_agent_id" IS NOT NULL AND "attachments"."uploader_customer_id" IS NULL)),
	CONSTRAINT "attachments_size_ck" CHECK ("attachments"."size_bytes" BETWEEN 1 AND 10485760)
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"ticket_id" uuid NOT NULL,
	"author_type" "participant_type" NOT NULL,
	"author_customer_id" uuid,
	"author_agent_id" uuid,
	"visibility" "message_visibility" NOT NULL,
	"body" text NOT NULL,
	"ai_suggestion_id" uuid,
	"approved_by_agent_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "messages_author_ck" CHECK (("messages"."author_type" = 'customer' AND "messages"."author_customer_id" IS NOT NULL AND "messages"."author_agent_id" IS NULL) OR ("messages"."author_type" = 'agent' AND "messages"."author_agent_id" IS NOT NULL AND "messages"."author_customer_id" IS NULL)),
	CONSTRAINT "messages_customer_public_ck" CHECK ("messages"."author_type" <> 'customer' OR "messages"."visibility" = 'public'),
	CONSTRAINT "messages_ai_approval_ck" CHECK ("messages"."ai_suggestion_id" IS NULL OR "messages"."approved_by_agent_id" IS NOT NULL),
	CONSTRAINT "messages_approver_is_author_ck" CHECK ("messages"."approved_by_agent_id" IS NULL OR "messages"."approved_by_agent_id" = "messages"."author_agent_id"),
	CONSTRAINT "messages_body_length_ck" CHECK (char_length("messages"."body") BETWEEN 1 AND 20000)
);
--> statement-breakpoint
CREATE TABLE "notification_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"event_id" uuid NOT NULL,
	"channel" "notification_channel" NOT NULL,
	"recipient_customer_id" uuid,
	"recipient_agent_id" uuid,
	"recipient_address" text NOT NULL,
	"template" text NOT NULL,
	"ticket_id" uuid,
	"status" "notification_status" DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"provider_message_id" text,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone,
	CONSTRAINT "notification_deliveries_event_channel_recipient_key" UNIQUE("event_id","channel","recipient_address")
);
--> statement-breakpoint
CREATE TABLE "outbox_events" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"event_type" text NOT NULL,
	"aggregate_type" text NOT NULL,
	"aggregate_id" uuid NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"dispatched_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "auth_tokens" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"purpose" "auth_token_purpose" NOT NULL,
	"token_hash" "bytea" NOT NULL,
	"customer_id" uuid,
	"agent_id" uuid,
	"ticket_id" uuid,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"last_used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "auth_tokens_token_hash_key" UNIQUE("token_hash"),
	CONSTRAINT "auth_tokens_subject_ck" CHECK (("auth_tokens"."purpose" = 'guest_ticket_access' AND "auth_tokens"."ticket_id" IS NOT NULL AND "auth_tokens"."customer_id" IS NOT NULL AND "auth_tokens"."agent_id" IS NULL) OR ("auth_tokens"."purpose" IN ('customer_signup', 'password_reset') AND "auth_tokens"."customer_id" IS NOT NULL AND "auth_tokens"."agent_id" IS NULL AND "auth_tokens"."ticket_id" IS NULL) OR ("auth_tokens"."purpose" = 'agent_invite' AND "auth_tokens"."agent_id" IS NOT NULL AND "auth_tokens"."customer_id" IS NULL AND "auth_tokens"."ticket_id" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"realm" "session_realm" NOT NULL,
	"token_hash" "bytea" NOT NULL,
	"customer_id" uuid,
	"agent_id" uuid,
	"guest_ticket_id" uuid,
	"ip" "inet",
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"idle_expires_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "sessions_token_hash_key" UNIQUE("token_hash"),
	CONSTRAINT "sessions_realm_ck" CHECK (("sessions"."realm" = 'customer' AND "sessions"."customer_id" IS NOT NULL AND "sessions"."agent_id" IS NULL) OR ("sessions"."realm" = 'staff' AND "sessions"."agent_id" IS NOT NULL AND "sessions"."customer_id" IS NULL AND "sessions"."guest_ticket_id" IS NULL)),
	CONSTRAINT "sessions_expiry_ck" CHECK ("sessions"."expires_at" > "sessions"."created_at")
);
--> statement-breakpoint
CREATE TABLE "tickets" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"number" bigint DEFAULT nextval('ticket_number_seq') NOT NULL,
	"reference" text NOT NULL,
	"brand_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"channel" "ticket_channel" NOT NULL,
	"subject" text NOT NULL,
	"description" text NOT NULL,
	"status" "ticket_status" DEFAULT 'open' NOT NULL,
	"priority" "ticket_priority" DEFAULT 'normal' NOT NULL,
	"assignee_agent_id" uuid,
	"contact_verified_at" timestamp with time zone,
	"escalated_at" timestamp with time zone,
	"escalated_by_agent_id" uuid,
	"first_response_at" timestamp with time zone,
	"resolved_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tickets_number_key" UNIQUE("number"),
	CONSTRAINT "tickets_reference_key" UNIQUE("reference"),
	CONSTRAINT "tickets_subject_length_ck" CHECK (char_length("tickets"."subject") BETWEEN 1 AND 200),
	CONSTRAINT "tickets_description_length_ck" CHECK (char_length("tickets"."description") BETWEEN 1 AND 20000),
	CONSTRAINT "tickets_resolved_at_ck" CHECK ("tickets"."resolved_at" IS NULL OR "tickets"."status" IN ('resolved', 'closed')),
	CONSTRAINT "tickets_closed_at_ck" CHECK (("tickets"."status" = 'closed') = ("tickets"."closed_at" IS NOT NULL)),
	CONSTRAINT "tickets_first_response_ck" CHECK ("tickets"."first_response_at" IS NULL OR "tickets"."first_response_at" >= "tickets"."created_at"),
	CONSTRAINT "tickets_escalation_ck" CHECK (("tickets"."escalated_at" IS NULL) = ("tickets"."escalated_by_agent_id" IS NULL))
);
--> statement-breakpoint
ALTER TABLE "ai_suggestion_feedback" ADD CONSTRAINT "ai_suggestion_feedback_suggestion_id_ai_suggestions_id_fk" FOREIGN KEY ("suggestion_id") REFERENCES "public"."ai_suggestions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_suggestion_feedback" ADD CONSTRAINT "ai_suggestion_feedback_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_suggestion_sources" ADD CONSTRAINT "ai_suggestion_sources_suggestion_id_ai_suggestions_id_fk" FOREIGN KEY ("suggestion_id") REFERENCES "public"."ai_suggestions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_suggestion_sources" ADD CONSTRAINT "ai_suggestion_sources_chunk_id_kb_chunks_id_fk" FOREIGN KEY ("chunk_id") REFERENCES "public"."kb_chunks"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_suggestions" ADD CONSTRAINT "ai_suggestions_ticket_id_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."tickets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_suggestions" ADD CONSTRAINT "ai_suggestions_requested_by_agent_id_agents_id_fk" FOREIGN KEY ("requested_by_agent_id") REFERENCES "public"."agents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_ticket_id_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."tickets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_actor_customer_id_customers_id_fk" FOREIGN KEY ("actor_customer_id") REFERENCES "public"."customers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_actor_agent_id_agents_id_fk" FOREIGN KEY ("actor_agent_id") REFERENCES "public"."agents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "canned_responses" ADD CONSTRAINT "canned_responses_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "canned_responses" ADD CONSTRAINT "canned_responses_created_by_agent_id_agents_id_fk" FOREIGN KEY ("created_by_agent_id") REFERENCES "public"."agents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "canned_responses" ADD CONSTRAINT "canned_responses_updated_by_agent_id_agents_id_fk" FOREIGN KEY ("updated_by_agent_id") REFERENCES "public"."agents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_brand_memberships" ADD CONSTRAINT "agent_brand_memberships_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_brand_memberships" ADD CONSTRAINT "agent_brand_memberships_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_invited_by_agent_id_agents_id_fk" FOREIGN KEY ("invited_by_agent_id") REFERENCES "public"."agents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kb_articles" ADD CONSTRAINT "kb_articles_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kb_articles" ADD CONSTRAINT "kb_articles_category_id_kb_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."kb_categories"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kb_articles" ADD CONSTRAINT "kb_articles_author_agent_id_agents_id_fk" FOREIGN KEY ("author_agent_id") REFERENCES "public"."agents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kb_articles" ADD CONSTRAINT "kb_articles_updated_by_agent_id_agents_id_fk" FOREIGN KEY ("updated_by_agent_id") REFERENCES "public"."agents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kb_categories" ADD CONSTRAINT "kb_categories_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kb_chunks" ADD CONSTRAINT "kb_chunks_article_id_kb_articles_id_fk" FOREIGN KEY ("article_id") REFERENCES "public"."kb_articles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_ticket_id_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."tickets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_uploader_customer_id_customers_id_fk" FOREIGN KEY ("uploader_customer_id") REFERENCES "public"."customers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_uploader_agent_id_agents_id_fk" FOREIGN KEY ("uploader_agent_id") REFERENCES "public"."agents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_ticket_id_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."tickets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_author_customer_id_customers_id_fk" FOREIGN KEY ("author_customer_id") REFERENCES "public"."customers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_author_agent_id_agents_id_fk" FOREIGN KEY ("author_agent_id") REFERENCES "public"."agents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_approved_by_agent_id_agents_id_fk" FOREIGN KEY ("approved_by_agent_id") REFERENCES "public"."agents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_ai_suggestion_fk" FOREIGN KEY ("ai_suggestion_id","ticket_id") REFERENCES "public"."ai_suggestions"("id","ticket_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_recipient_customer_id_customers_id_fk" FOREIGN KEY ("recipient_customer_id") REFERENCES "public"."customers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_recipient_agent_id_agents_id_fk" FOREIGN KEY ("recipient_agent_id") REFERENCES "public"."agents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_ticket_id_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."tickets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_tokens" ADD CONSTRAINT "auth_tokens_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_tokens" ADD CONSTRAINT "auth_tokens_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_tokens" ADD CONSTRAINT "auth_tokens_ticket_id_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."tickets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_guest_ticket_id_tickets_id_fk" FOREIGN KEY ("guest_ticket_id") REFERENCES "public"."tickets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_assignee_agent_id_agents_id_fk" FOREIGN KEY ("assignee_agent_id") REFERENCES "public"."agents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_escalated_by_agent_id_agents_id_fk" FOREIGN KEY ("escalated_by_agent_id") REFERENCES "public"."agents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_suggestions_ticket_idx" ON "ai_suggestions" USING btree ("ticket_id","created_at" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "audit_events_ticket_idx" ON "audit_events" USING btree ("ticket_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_events_entity_idx" ON "audit_events" USING btree ("entity_type","entity_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "canned_responses_active_title_key" ON "canned_responses" USING btree ("brand_id","title") WHERE "canned_responses"."retired_at" IS NULL;--> statement-breakpoint
CREATE INDEX "kb_articles_search_idx" ON "kb_articles" USING gin ("search_vector");--> statement-breakpoint
CREATE INDEX "kb_articles_browse_idx" ON "kb_articles" USING btree ("brand_id","status","published_at" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "kb_articles_tags_idx" ON "kb_articles" USING gin ("tags");--> statement-breakpoint
CREATE INDEX "kb_chunks_embedding_idx" ON "kb_chunks" USING hnsw ("embedding" vector_cosine_ops);--> statement-breakpoint
CREATE INDEX "kb_chunks_search_idx" ON "kb_chunks" USING gin ("search_vector");--> statement-breakpoint
CREATE INDEX "kb_chunks_article_current_idx" ON "kb_chunks" USING btree ("article_id","is_current");--> statement-breakpoint
CREATE INDEX "attachments_ticket_idx" ON "attachments" USING btree ("ticket_id");--> statement-breakpoint
CREATE INDEX "attachments_message_idx" ON "attachments" USING btree ("message_id");--> statement-breakpoint
CREATE INDEX "messages_thread_idx" ON "messages" USING btree ("ticket_id","created_at","id");--> statement-breakpoint
CREATE INDEX "notification_deliveries_status_idx" ON "notification_deliveries" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "outbox_events_pending_idx" ON "outbox_events" USING btree ("id") WHERE "outbox_events"."dispatched_at" IS NULL;--> statement-breakpoint
CREATE INDEX "outbox_events_dispatched_idx" ON "outbox_events" USING btree ("dispatched_at") WHERE "outbox_events"."dispatched_at" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "auth_tokens_expires_at_idx" ON "auth_tokens" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "sessions_expires_at_idx" ON "sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "sessions_agent_idx" ON "sessions" USING btree ("agent_id") WHERE "sessions"."revoked_at" IS NULL;--> statement-breakpoint
CREATE INDEX "sessions_customer_idx" ON "sessions" USING btree ("customer_id") WHERE "sessions"."revoked_at" IS NULL;--> statement-breakpoint
CREATE INDEX "tickets_queue_idx" ON "tickets" USING btree ("brand_id","status","priority" DESC NULLS FIRST,"created_at");--> statement-breakpoint
CREATE INDEX "tickets_brand_created_idx" ON "tickets" USING btree ("brand_id","created_at");--> statement-breakpoint
CREATE INDEX "tickets_assignee_idx" ON "tickets" USING btree ("assignee_agent_id","status") WHERE "tickets"."assignee_agent_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "tickets_customer_idx" ON "tickets" USING btree ("customer_id","created_at" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "tickets_escalated_idx" ON "tickets" USING btree ("brand_id","escalated_at") WHERE "tickets"."escalated_at" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "tickets_resolved_idx" ON "tickets" USING btree ("brand_id","resolved_at") WHERE "tickets"."resolved_at" IS NOT NULL;