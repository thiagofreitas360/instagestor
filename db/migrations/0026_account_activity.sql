ALTER TABLE "instagram_accounts" ADD COLUMN "active_started_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "instagram_accounts" ALTER COLUMN "active_started_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "instagram_accounts" ADD COLUMN "active_ended_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "instagram_accounts" ADD COLUMN "active_timing_estimated" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "instagram_accounts" ADD CONSTRAINT "instagram_accounts_activity_dates_valid" CHECK ("instagram_accounts"."active_ended_at" IS NULL OR "instagram_accounts"."active_started_at" IS NULL OR "instagram_accounts"."active_ended_at" >= "instagram_accounts"."active_started_at");
