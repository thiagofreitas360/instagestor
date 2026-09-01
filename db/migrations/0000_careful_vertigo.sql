CREATE TYPE "public"."campaign_status" AS ENUM('DRAFT', 'SCHEDULED', 'RUNNING', 'PAUSED', 'COMPLETED', 'PARTIALLY_FAILED', 'FAILED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."delay_mode" AS ENUM('FIXED', 'RANDOM');--> statement-breakpoint
CREATE TYPE "public"."instagram_account_status" AS ENUM('CONNECTED', 'TOKEN_EXPIRING', 'REAUTH_REQUIRED', 'DISCONNECTED', 'ERROR', 'DISABLED');--> statement-breakpoint
CREATE TYPE "public"."media_kind" AS ENUM('IMAGE', 'VIDEO');--> statement-breakpoint
CREATE TYPE "public"."media_processing_status" AS ENUM('UPLOADING', 'READY', 'INVALID', 'DELETED');--> statement-breakpoint
CREATE TYPE "public"."publication_job_status" AS ENUM('QUEUED', 'CLAIMED', 'CREATING_CONTAINER', 'WAITING_FOR_CONTAINER', 'READY_TO_PUBLISH', 'PUBLISHING', 'PUBLISHED', 'RETRY_WAIT', 'RECONCILIATION_REQUIRED', 'FAILED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."publication_type" AS ENUM('FEED_IMAGE', 'FEED_VIDEO', 'REEL', 'STORY_IMAGE', 'STORY_VIDEO', 'CAROUSEL');--> statement-breakpoint
CREATE TYPE "public"."publishing_phase" AS ENUM('CREATE_CONTAINER', 'WAIT_CONTAINER', 'PUBLISH', 'DONE');--> statement-breakpoint
CREATE TYPE "public"."storage_provider" AS ENUM('LOCAL', 'S3');--> statement-breakpoint
CREATE TYPE "public"."target_order" AS ENUM('SELECTED', 'RANDOM', 'USERNAME');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('ADMIN');--> statement-breakpoint
CREATE TABLE "account_group_members" (
	"group_id" uuid NOT NULL,
	"instagram_account_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "account_group_members_group_id_instagram_account_id_pk" PRIMARY KEY("group_id","instagram_account_id")
);
--> statement-breakpoint
CREATE TABLE "account_groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "account_groups_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_user_id" uuid,
	"event_type" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text,
	"metadata_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "campaign_media" (
	"campaign_id" uuid NOT NULL,
	"media_asset_id" uuid NOT NULL,
	"position" integer NOT NULL,
	CONSTRAINT "campaign_media_campaign_id_position_pk" PRIMARY KEY("campaign_id","position"),
	CONSTRAINT "campaign_media_asset_unique" UNIQUE("campaign_id","media_asset_id"),
	CONSTRAINT "campaign_media_position_nonnegative" CHECK ("campaign_media"."position" >= 0)
);
--> statement-breakpoint
CREATE TABLE "campaign_targets" (
	"campaign_id" uuid NOT NULL,
	"instagram_account_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "campaign_targets_campaign_id_instagram_account_id_pk" PRIMARY KEY("campaign_id","instagram_account_id"),
	CONSTRAINT "campaign_targets_position_unique" UNIQUE("campaign_id","position")
);
--> statement-breakpoint
CREATE TABLE "campaigns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"publication_type" "publication_type" NOT NULL,
	"caption" text,
	"status" "campaign_status" DEFAULT 'DRAFT' NOT NULL,
	"start_at" timestamp with time zone,
	"timezone" text DEFAULT 'America/Sao_Paulo' NOT NULL,
	"delay_mode" "delay_mode" DEFAULT 'FIXED' NOT NULL,
	"delay_fixed_seconds" integer,
	"delay_min_seconds" integer,
	"delay_max_seconds" integer,
	"target_order" "target_order" DEFAULT 'SELECTED' NOT NULL,
	"share_to_feed" boolean DEFAULT false NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"scheduled_at" timestamp with time zone,
	"paused_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	CONSTRAINT "campaigns_delay_values_valid" CHECK (("campaigns"."delay_mode" = 'FIXED' AND "campaigns"."delay_fixed_seconds" IS NOT NULL AND "campaigns"."delay_fixed_seconds" >= 0) OR ("campaigns"."delay_mode" = 'RANDOM' AND "campaigns"."delay_min_seconds" IS NOT NULL AND "campaigns"."delay_max_seconds" IS NOT NULL AND "campaigns"."delay_min_seconds" >= 0 AND "campaigns"."delay_max_seconds" >= "campaigns"."delay_min_seconds"))
);
--> statement-breakpoint
CREATE TABLE "instagram_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"instagram_user_id" text NOT NULL,
	"username" text NOT NULL,
	"display_name" text,
	"profile_picture_url" text,
	"account_type" text,
	"status" "instagram_account_status" DEFAULT 'CONNECTED' NOT NULL,
	"encrypted_access_token" text,
	"token_expires_at" timestamp with time zone,
	"token_last_refreshed_at" timestamp with time zone,
	"token_last_checked_at" timestamp with time zone,
	"last_successful_api_call_at" timestamp with time zone,
	"last_error_at" timestamp with time zone,
	"last_error_code" text,
	"last_error_message" text,
	"publishing_limit_usage" integer,
	"publishing_limit_total" integer,
	"publishing_limit_checked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"disconnected_at" timestamp with time zone,
	CONSTRAINT "instagram_accounts_instagram_user_id_unique" UNIQUE("instagram_user_id")
);
--> statement-breakpoint
CREATE TABLE "login_attempts" (
	"key_hash" text PRIMARY KEY NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"window_started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"blocked_until" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "media_assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"original_filename" text NOT NULL,
	"storage_provider" "storage_provider" NOT NULL,
	"storage_key" text NOT NULL,
	"mime_type" text NOT NULL,
	"media_kind" "media_kind" NOT NULL,
	"size_bytes" bigint NOT NULL,
	"checksum_sha256" text NOT NULL,
	"width" integer,
	"height" integer,
	"duration_seconds" real,
	"processing_status" "media_processing_status" DEFAULT 'UPLOADING' NOT NULL,
	"validation_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "media_assets_storage_key_unique" UNIQUE("storage_key"),
	CONSTRAINT "media_assets_size_positive" CHECK ("media_assets"."size_bytes" > 0)
);
--> statement-breakpoint
CREATE TABLE "oauth_states" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"nonce_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "oauth_states_nonce_hash_unique" UNIQUE("nonce_hash")
);
--> statement-breakpoint
CREATE TABLE "publication_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"instagram_account_id" uuid NOT NULL,
	"scheduled_at" timestamp with time zone NOT NULL,
	"status" "publication_job_status" DEFAULT 'QUEUED' NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 8 NOT NULL,
	"next_attempt_at" timestamp with time zone,
	"locked_at" timestamp with time zone,
	"locked_by" text,
	"lock_expires_at" timestamp with time zone,
	"fencing_token" bigint DEFAULT 0 NOT NULL,
	"meta_container_id" text,
	"meta_media_id" text,
	"publishing_phase" "publishing_phase",
	"started_at" timestamp with time zone,
	"published_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"last_error_code" text,
	"last_error_type" text,
	"last_error_message" text,
	"last_http_status" integer,
	"reconciliation_required" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "publication_jobs_campaign_account_unique" UNIQUE("campaign_id","instagram_account_id"),
	CONSTRAINT "publication_jobs_attempts_valid" CHECK ("publication_jobs"."attempt_count" >= 0 AND "publication_jobs"."max_attempts" > 0)
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"id" boolean PRIMARY KEY DEFAULT true NOT NULL,
	"default_timezone" text DEFAULT 'America/Sao_Paulo' NOT NULL,
	"default_delay_mode" "delay_mode" DEFAULT 'FIXED' NOT NULL,
	"default_delay_min" integer DEFAULT 120 NOT NULL,
	"default_delay_max" integer DEFAULT 300 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "settings_singleton" CHECK ("settings"."id" = true),
	CONSTRAINT "settings_delay_valid" CHECK ("settings"."default_delay_min" >= 0 AND "settings"."default_delay_max" >= "settings"."default_delay_min")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"role" "user_role" DEFAULT 'ADMIN' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_login_at" timestamp with time zone,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "worker_heartbeats" (
	"worker_id" text PRIMARY KEY NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"active_jobs" integer DEFAULT 0 NOT NULL,
	"version" text
);
--> statement-breakpoint
ALTER TABLE "account_group_members" ADD CONSTRAINT "account_group_members_group_id_account_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."account_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_group_members" ADD CONSTRAINT "account_group_members_instagram_account_id_instagram_accounts_id_fk" FOREIGN KEY ("instagram_account_id") REFERENCES "public"."instagram_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_media" ADD CONSTRAINT "campaign_media_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_media" ADD CONSTRAINT "campaign_media_media_asset_id_media_assets_id_fk" FOREIGN KEY ("media_asset_id") REFERENCES "public"."media_assets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_targets" ADD CONSTRAINT "campaign_targets_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_targets" ADD CONSTRAINT "campaign_targets_instagram_account_id_instagram_accounts_id_fk" FOREIGN KEY ("instagram_account_id") REFERENCES "public"."instagram_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publication_jobs" ADD CONSTRAINT "publication_jobs_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publication_jobs" ADD CONSTRAINT "publication_jobs_instagram_account_id_instagram_accounts_id_fk" FOREIGN KEY ("instagram_account_id") REFERENCES "public"."instagram_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_logs_created_idx" ON "audit_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "campaigns_status_idx" ON "campaigns" USING btree ("status");--> statement-breakpoint
CREATE INDEX "instagram_accounts_status_idx" ON "instagram_accounts" USING btree ("status");--> statement-breakpoint
CREATE INDEX "media_assets_status_idx" ON "media_assets" USING btree ("processing_status");--> statement-breakpoint
CREATE INDEX "oauth_states_expiry_idx" ON "oauth_states" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "publication_jobs_status_scheduled_idx" ON "publication_jobs" USING btree ("status","scheduled_at");--> statement-breakpoint
CREATE INDEX "publication_jobs_status_retry_idx" ON "publication_jobs" USING btree ("status","next_attempt_at");--> statement-breakpoint
CREATE INDEX "publication_jobs_account_idx" ON "publication_jobs" USING btree ("instagram_account_id");--> statement-breakpoint
CREATE INDEX "publication_jobs_campaign_idx" ON "publication_jobs" USING btree ("campaign_id");--> statement-breakpoint
CREATE INDEX "publication_jobs_stale_lock_idx" ON "publication_jobs" USING btree ("lock_expires_at");