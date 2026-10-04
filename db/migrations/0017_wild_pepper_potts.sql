CREATE TYPE "public"."auto_comment_status" AS ENUM('QUEUED', 'PROCESSING', 'PUBLISHED', 'RETRY_WAIT', 'RECONCILIATION_REQUIRED', 'FAILED');--> statement-breakpoint
ALTER TABLE "loops" ADD COLUMN "auto_comment_text" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "loops" ADD COLUMN "auto_comment_delay_minutes" integer DEFAULT 5 NOT NULL;--> statement-breakpoint
ALTER TABLE "loops" ADD COLUMN "tiered_limits" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "loops" ADD COLUMN "tier_follower_threshold" integer DEFAULT 10000 NOT NULL;--> statement-breakpoint
ALTER TABLE "loops" ADD COLUMN "tier1_daily_limit" integer DEFAULT 10 NOT NULL;--> statement-breakpoint
ALTER TABLE "loops" ADD COLUMN "tier1_min_interval_minutes" integer DEFAULT 60 NOT NULL;--> statement-breakpoint
ALTER TABLE "loops" ADD COLUMN "tier1_max_interval_minutes" integer DEFAULT 120 NOT NULL;--> statement-breakpoint
ALTER TABLE "publication_jobs" ADD COLUMN "auto_comment_text" text;--> statement-breakpoint
ALTER TABLE "publication_jobs" ADD COLUMN "auto_comment_delay_minutes" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "publication_jobs" ADD COLUMN "auto_comment_status" "auto_comment_status";--> statement-breakpoint
ALTER TABLE "publication_jobs" ADD COLUMN "auto_comment_scheduled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "publication_jobs" ADD COLUMN "auto_comment_attempt_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "publication_jobs" ADD COLUMN "auto_comment_max_attempts" integer DEFAULT 5 NOT NULL;--> statement-breakpoint
ALTER TABLE "publication_jobs" ADD COLUMN "auto_comment_locked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "publication_jobs" ADD COLUMN "auto_comment_locked_by" text;--> statement-breakpoint
ALTER TABLE "publication_jobs" ADD COLUMN "auto_comment_lock_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "publication_jobs" ADD COLUMN "auto_comment_fencing_token" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "publication_jobs" ADD COLUMN "meta_comment_id" text;--> statement-breakpoint
ALTER TABLE "publication_jobs" ADD COLUMN "auto_comment_published_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "publication_jobs" ADD COLUMN "auto_comment_last_error_code" text;--> statement-breakpoint
ALTER TABLE "publication_jobs" ADD COLUMN "auto_comment_last_error_type" text;--> statement-breakpoint
ALTER TABLE "publication_jobs" ADD COLUMN "auto_comment_last_error_message" text;--> statement-breakpoint
ALTER TABLE "publication_jobs" ADD COLUMN "auto_comment_last_http_status" integer;--> statement-breakpoint
ALTER TABLE "schedules" ADD COLUMN "auto_comment_text" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "schedules" ADD COLUMN "auto_comment_delay_minutes" integer DEFAULT 5 NOT NULL;--> statement-breakpoint
CREATE INDEX "publication_jobs_auto_comment_due_idx" ON "publication_jobs" USING btree ("auto_comment_status","auto_comment_scheduled_at");--> statement-breakpoint
CREATE INDEX "publication_jobs_auto_comment_stale_lock_idx" ON "publication_jobs" USING btree ("auto_comment_lock_expires_at");--> statement-breakpoint
ALTER TABLE "loops" ADD CONSTRAINT "loops_auto_comment_delay_valid" CHECK ("loops"."auto_comment_delay_minutes" BETWEEN 0 AND 10080);--> statement-breakpoint
ALTER TABLE "loops" ADD CONSTRAINT "loops_tier_limits_valid" CHECK ("loops"."tier_follower_threshold" BETWEEN 0 AND 100000000 AND "loops"."tier1_daily_limit" BETWEEN 1 AND 200 AND "loops"."tier1_min_interval_minutes" BETWEEN 1 AND 1440 AND "loops"."tier1_max_interval_minutes" BETWEEN "loops"."tier1_min_interval_minutes" AND 1440);--> statement-breakpoint
ALTER TABLE "publication_jobs" ADD CONSTRAINT "publication_jobs_auto_comment_delay_valid" CHECK ("publication_jobs"."auto_comment_delay_minutes" BETWEEN 0 AND 10080);--> statement-breakpoint
ALTER TABLE "publication_jobs" ADD CONSTRAINT "publication_jobs_auto_comment_attempts_valid" CHECK ("publication_jobs"."auto_comment_attempt_count" >= 0 AND "publication_jobs"."auto_comment_max_attempts" > 0);--> statement-breakpoint
ALTER TABLE "schedules" ADD CONSTRAINT "schedules_auto_comment_delay_valid" CHECK ("schedules"."auto_comment_delay_minutes" BETWEEN 0 AND 10080);