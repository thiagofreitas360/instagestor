CREATE TYPE "public"."app_theme" AS ENUM('LIGHT', 'DARK');--> statement-breakpoint
CREATE TYPE "public"."automated_media_type" AS ENUM('REELS', 'IMAGE', 'MIXED');--> statement-breakpoint
CREATE TYPE "public"."campaign_origin" AS ENUM('MANUAL', 'LOOP', 'SCHEDULE');--> statement-breakpoint
CREATE TYPE "public"."loop_status" AS ENUM('ACTIVE', 'PAUSED');--> statement-breakpoint
CREATE TYPE "public"."schedule_status" AS ENUM('ACTIVE', 'CANCELLED');--> statement-breakpoint
CREATE TABLE "loop_account_state" (
	"organization_id" uuid NOT NULL,
	"loop_id" uuid NOT NULL,
	"instagram_account_id" uuid NOT NULL,
	"used_media_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"videos_since_image" integer DEFAULT 0 NOT NULL,
	"finished" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "loop_account_state_loop_id_instagram_account_id_pk" PRIMARY KEY("loop_id","instagram_account_id"),
	CONSTRAINT "loop_account_state_video_count_valid" CHECK ("loop_account_state"."videos_since_image" >= 0)
);
--> statement-breakpoint
CREATE TABLE "loop_accounts" (
	"organization_id" uuid NOT NULL,
	"loop_id" uuid NOT NULL,
	"instagram_account_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "loop_accounts_loop_id_instagram_account_id_pk" PRIMARY KEY("loop_id","instagram_account_id")
);
--> statement-breakpoint
CREATE TABLE "loop_media" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"loop_id" uuid NOT NULL,
	"media_asset_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "loop_media_loop_asset_unique" UNIQUE("loop_id","media_asset_id"),
	CONSTRAINT "loop_media_loop_position_unique" UNIQUE("loop_id","position"),
	CONSTRAINT "loop_media_position_nonnegative" CHECK ("loop_media"."position" >= 0)
);
--> statement-breakpoint
CREATE TABLE "loops" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"campaign_id" uuid NOT NULL,
	"name" text NOT NULL,
	"status" "loop_status" DEFAULT 'ACTIVE' NOT NULL,
	"default_caption" text DEFAULT '' NOT NULL,
	"min_interval_minutes" integer DEFAULT 20 NOT NULL,
	"max_interval_minutes" integer DEFAULT 40 NOT NULL,
	"daily_limit_per_account" integer DEFAULT 40 NOT NULL,
	"media_type" "automated_media_type" DEFAULT 'REELS' NOT NULL,
	"image_every_n" integer DEFAULT 0 NOT NULL,
	"no_repeat" boolean DEFAULT false NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "loops_campaign_id_unique" UNIQUE("campaign_id"),
	CONSTRAINT "loops_organization_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "loops_name_valid" CHECK (length(trim("loops"."name")) BETWEEN 1 AND 160),
	CONSTRAINT "loops_limits_valid" CHECK ("loops"."min_interval_minutes" BETWEEN 1 AND 1440 AND "loops"."max_interval_minutes" BETWEEN "loops"."min_interval_minutes" AND 1440 AND "loops"."daily_limit_per_account" BETWEEN 1 AND 200),
	CONSTRAINT "loops_image_frequency_valid" CHECK (("loops"."media_type" = 'MIXED' AND "loops"."image_every_n" BETWEEN 1 AND 100) OR ("loops"."media_type" <> 'MIXED' AND "loops"."image_every_n" = 0))
);
--> statement-breakpoint
CREATE TABLE "schedule_accounts" (
	"organization_id" uuid NOT NULL,
	"schedule_id" uuid NOT NULL,
	"instagram_account_id" uuid NOT NULL,
	CONSTRAINT "schedule_accounts_schedule_id_instagram_account_id_pk" PRIMARY KEY("schedule_id","instagram_account_id")
);
--> statement-breakpoint
CREATE TABLE "schedule_media" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"schedule_id" uuid NOT NULL,
	"media_asset_id" uuid NOT NULL,
	"position" integer NOT NULL,
	CONSTRAINT "schedule_media_schedule_asset_unique" UNIQUE("schedule_id","media_asset_id"),
	CONSTRAINT "schedule_media_schedule_position_unique" UNIQUE("schedule_id","position")
);
--> statement-breakpoint
CREATE TABLE "schedules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"campaign_id" uuid NOT NULL,
	"name" text NOT NULL,
	"status" "schedule_status" DEFAULT 'ACTIVE' NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"times" text[] NOT NULL,
	"days_of_week" integer[] NOT NULL,
	"timezone" text DEFAULT 'America/Sao_Paulo' NOT NULL,
	"media_type" "automated_media_type" NOT NULL,
	"default_caption" text DEFAULT '' NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "schedules_campaign_id_unique" UNIQUE("campaign_id"),
	CONSTRAINT "schedules_organization_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "schedules_name_valid" CHECK (length(trim("schedules"."name")) BETWEEN 1 AND 160),
	CONSTRAINT "schedules_period_valid" CHECK ("schedules"."end_date" >= "schedules"."start_date"),
	CONSTRAINT "schedules_media_type_valid" CHECK ("schedules"."media_type" IN ('REELS', 'IMAGE'))
);
--> statement-breakpoint
ALTER TABLE "publication_jobs" DROP CONSTRAINT "publication_jobs_campaign_account_position_unique";--> statement-breakpoint
ALTER TABLE "account_groups" ADD COLUMN "color" text DEFAULT '#4f46e5' NOT NULL;--> statement-breakpoint
ALTER TABLE "media_folders" ADD COLUMN "origin" "campaign_origin" DEFAULT 'MANUAL' NOT NULL;--> statement-breakpoint
ALTER TABLE "publication_jobs" ADD COLUMN "loop_id" uuid;--> statement-breakpoint
ALTER TABLE "publication_jobs" ADD COLUMN "schedule_id" uuid;--> statement-breakpoint
ALTER TABLE "publication_jobs" ADD COLUMN "direct_media_asset_id" uuid;--> statement-breakpoint
ALTER TABLE "publication_jobs" ADD COLUMN "publication_type_override" "publication_type";--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "theme" "app_theme" DEFAULT 'LIGHT' NOT NULL;--> statement-breakpoint
ALTER TABLE "loop_account_state" ADD CONSTRAINT "loop_account_state_loop_id_loops_id_fk" FOREIGN KEY ("loop_id") REFERENCES "public"."loops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loop_account_state" ADD CONSTRAINT "loop_account_state_instagram_account_id_instagram_accounts_id_fk" FOREIGN KEY ("instagram_account_id") REFERENCES "public"."instagram_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loop_account_state" ADD CONSTRAINT "loop_account_state_organization_loop_fk" FOREIGN KEY ("organization_id","loop_id") REFERENCES "public"."loops"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loop_account_state" ADD CONSTRAINT "loop_account_state_organization_account_fk" FOREIGN KEY ("organization_id","instagram_account_id") REFERENCES "public"."instagram_accounts"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loop_accounts" ADD CONSTRAINT "loop_accounts_loop_id_loops_id_fk" FOREIGN KEY ("loop_id") REFERENCES "public"."loops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loop_accounts" ADD CONSTRAINT "loop_accounts_instagram_account_id_instagram_accounts_id_fk" FOREIGN KEY ("instagram_account_id") REFERENCES "public"."instagram_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loop_accounts" ADD CONSTRAINT "loop_accounts_organization_loop_fk" FOREIGN KEY ("organization_id","loop_id") REFERENCES "public"."loops"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loop_accounts" ADD CONSTRAINT "loop_accounts_organization_account_fk" FOREIGN KEY ("organization_id","instagram_account_id") REFERENCES "public"."instagram_accounts"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loop_media" ADD CONSTRAINT "loop_media_loop_id_loops_id_fk" FOREIGN KEY ("loop_id") REFERENCES "public"."loops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loop_media" ADD CONSTRAINT "loop_media_media_asset_id_media_assets_id_fk" FOREIGN KEY ("media_asset_id") REFERENCES "public"."media_assets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loop_media" ADD CONSTRAINT "loop_media_organization_loop_fk" FOREIGN KEY ("organization_id","loop_id") REFERENCES "public"."loops"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loop_media" ADD CONSTRAINT "loop_media_organization_asset_fk" FOREIGN KEY ("organization_id","media_asset_id") REFERENCES "public"."media_assets"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loops" ADD CONSTRAINT "loops_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loops" ADD CONSTRAINT "loops_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loops" ADD CONSTRAINT "loops_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loops" ADD CONSTRAINT "loops_organization_campaign_fk" FOREIGN KEY ("organization_id","campaign_id") REFERENCES "public"."campaigns"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_accounts" ADD CONSTRAINT "schedule_accounts_schedule_id_schedules_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "public"."schedules"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_accounts" ADD CONSTRAINT "schedule_accounts_instagram_account_id_instagram_accounts_id_fk" FOREIGN KEY ("instagram_account_id") REFERENCES "public"."instagram_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_accounts" ADD CONSTRAINT "schedule_accounts_organization_schedule_fk" FOREIGN KEY ("organization_id","schedule_id") REFERENCES "public"."schedules"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_accounts" ADD CONSTRAINT "schedule_accounts_organization_account_fk" FOREIGN KEY ("organization_id","instagram_account_id") REFERENCES "public"."instagram_accounts"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_media" ADD CONSTRAINT "schedule_media_schedule_id_schedules_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "public"."schedules"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_media" ADD CONSTRAINT "schedule_media_media_asset_id_media_assets_id_fk" FOREIGN KEY ("media_asset_id") REFERENCES "public"."media_assets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_media" ADD CONSTRAINT "schedule_media_organization_schedule_fk" FOREIGN KEY ("organization_id","schedule_id") REFERENCES "public"."schedules"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_media" ADD CONSTRAINT "schedule_media_organization_asset_fk" FOREIGN KEY ("organization_id","media_asset_id") REFERENCES "public"."media_assets"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedules" ADD CONSTRAINT "schedules_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedules" ADD CONSTRAINT "schedules_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedules" ADD CONSTRAINT "schedules_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedules" ADD CONSTRAINT "schedules_organization_campaign_fk" FOREIGN KEY ("organization_id","campaign_id") REFERENCES "public"."campaigns"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "loops_organization_status_idx" ON "loops" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "schedules_organization_status_idx" ON "schedules" USING btree ("organization_id","status");--> statement-breakpoint
ALTER TABLE "publication_jobs" ADD CONSTRAINT "publication_jobs_loop_id_loops_id_fk" FOREIGN KEY ("loop_id") REFERENCES "public"."loops"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publication_jobs" ADD CONSTRAINT "publication_jobs_schedule_id_schedules_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "public"."schedules"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publication_jobs" ADD CONSTRAINT "publication_jobs_direct_media_asset_id_media_assets_id_fk" FOREIGN KEY ("direct_media_asset_id") REFERENCES "public"."media_assets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publication_jobs" ADD CONSTRAINT "publication_jobs_organization_direct_media_fk" FOREIGN KEY ("organization_id","direct_media_asset_id") REFERENCES "public"."media_assets"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "publication_jobs_campaign_account_position_unique" ON "publication_jobs" USING btree ("campaign_id","instagram_account_id","publication_position") WHERE "publication_jobs"."loop_id" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "publication_jobs_one_active_per_loop_account" ON "publication_jobs" USING btree ("loop_id","instagram_account_id") WHERE "publication_jobs"."loop_id" IS NOT NULL AND "publication_jobs"."status" IN ('DRAFT', 'QUEUED', 'CLAIMED', 'CREATING_CONTAINER', 'WAITING_FOR_CONTAINER', 'READY_TO_PUBLISH', 'PUBLISHING', 'RETRY_WAIT');--> statement-breakpoint
ALTER TABLE "account_groups" ADD CONSTRAINT "account_groups_color_valid" CHECK ("account_groups"."color" ~ '^#[0-9a-fA-F]{6}$');