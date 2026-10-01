ALTER TYPE "public"."publication_job_status" ADD VALUE 'DRAFT' BEFORE 'QUEUED';--> statement-breakpoint
CREATE TABLE "media_folders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "media_folders_name_valid" CHECK (length(trim("media_folders"."name")) BETWEEN 1 AND 120)
);
--> statement-breakpoint
ALTER TABLE "publication_jobs" DROP CONSTRAINT "publication_jobs_campaign_account_unique";--> statement-breakpoint
ALTER TABLE "settings" ALTER COLUMN "default_delay_mode" SET DEFAULT 'RANDOM';--> statement-breakpoint
ALTER TABLE "settings" ALTER COLUMN "default_delay_min" SET DEFAULT 1500;--> statement-breakpoint
ALTER TABLE "settings" ALTER COLUMN "default_delay_max" SET DEFAULT 3600;--> statement-breakpoint
ALTER TABLE "media_assets" ADD COLUMN "folder_id" uuid;--> statement-breakpoint
ALTER TABLE "publication_jobs" ADD COLUMN "publication_position" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "media_folders_name_unique" ON "media_folders" USING btree (lower("name"));--> statement-breakpoint
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_folder_id_media_folders_id_fk" FOREIGN KEY ("folder_id") REFERENCES "public"."media_folders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "media_assets_folder_idx" ON "media_assets" USING btree ("folder_id");--> statement-breakpoint
ALTER TABLE "publication_jobs" ADD CONSTRAINT "publication_jobs_campaign_account_position_unique" UNIQUE("campaign_id","instagram_account_id","publication_position");--> statement-breakpoint
ALTER TABLE "publication_jobs" ADD CONSTRAINT "publication_jobs_position_nonnegative" CHECK ("publication_jobs"."publication_position" >= 0);--> statement-breakpoint
UPDATE "settings"
SET "default_delay_mode" = 'RANDOM', "default_delay_min" = 1500, "default_delay_max" = 3600, "updated_at" = now()
WHERE "default_delay_mode" = 'FIXED' AND "default_delay_min" = 120 AND "default_delay_max" = 300;
