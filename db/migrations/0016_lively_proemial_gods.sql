ALTER TABLE "campaigns" ADD COLUMN "origin" "campaign_origin" DEFAULT 'MANUAL' NOT NULL;--> statement-breakpoint
ALTER TABLE "media_folders" DROP COLUMN "origin";