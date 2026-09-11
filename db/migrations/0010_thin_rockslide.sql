ALTER TYPE "public"."instagram_account_status" ADD VALUE 'BANNED';--> statement-breakpoint
CREATE TABLE "account_daily_metrics" (
	"instagram_account_id" uuid NOT NULL,
	"day" date NOT NULL,
	"followers_count" integer,
	"follows_count" integer,
	"media_count" integer,
	"follower_gains" integer,
	"reach" integer,
	"views" integer,
	"profile_views" integer,
	"accounts_engaged" integer,
	"total_interactions" integer,
	"likes" integer,
	"comments" integer,
	"shares" integer,
	"saves" integer,
	"replies" integer,
	"website_clicks" integer,
	"profile_links_taps" integer,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "account_daily_metrics_instagram_account_id_day_pk" PRIMARY KEY("instagram_account_id","day")
);
--> statement-breakpoint
CREATE TABLE "account_media" (
	"id" text PRIMARY KEY NOT NULL,
	"instagram_account_id" uuid NOT NULL,
	"media_type" text NOT NULL,
	"product_type" text NOT NULL,
	"permalink" text,
	"thumbnail_url" text,
	"caption" text,
	"posted_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone,
	"like_count" integer,
	"comments_count" integer,
	"views" integer,
	"reach" integer,
	"shares" integer,
	"saved" integer,
	"total_interactions" integer,
	"replies" integer,
	"follows" integer,
	"profile_visits" integer,
	"reels_avg_watch_time_ms" integer,
	"reels_total_watch_time_ms" bigint,
	"story_taps_forward" integer,
	"story_taps_back" integer,
	"story_exits" integer,
	"insights_synced_at" timestamp with time zone,
	"published_job_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "account_media_product_type_valid" CHECK ("account_media"."product_type" IN ('FEED', 'REELS', 'STORY'))
);
--> statement-breakpoint
ALTER TABLE "instagram_accounts" ADD COLUMN "granted_scopes" text[];--> statement-breakpoint
ALTER TABLE "instagram_accounts" ADD COLUMN "biography" text;--> statement-breakpoint
ALTER TABLE "instagram_accounts" ADD COLUMN "website" text;--> statement-breakpoint
ALTER TABLE "instagram_accounts" ADD COLUMN "insights_synced_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "instagram_accounts" ADD COLUMN "insights_error_code" text;--> statement-breakpoint
ALTER TABLE "instagram_accounts" ADD COLUMN "banned_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "instagram_accounts" ADD COLUMN "ban_reason" text;--> statement-breakpoint
ALTER TABLE "account_daily_metrics" ADD CONSTRAINT "account_daily_metrics_instagram_account_id_instagram_accounts_id_fk" FOREIGN KEY ("instagram_account_id") REFERENCES "public"."instagram_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_media" ADD CONSTRAINT "account_media_instagram_account_id_instagram_accounts_id_fk" FOREIGN KEY ("instagram_account_id") REFERENCES "public"."instagram_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_media" ADD CONSTRAINT "account_media_published_job_id_publication_jobs_id_fk" FOREIGN KEY ("published_job_id") REFERENCES "public"."publication_jobs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_daily_metrics_day_idx" ON "account_daily_metrics" USING btree ("day");--> statement-breakpoint
CREATE INDEX "account_media_account_posted_idx" ON "account_media" USING btree ("instagram_account_id","posted_at");--> statement-breakpoint
CREATE INDEX "account_media_posted_idx" ON "account_media" USING btree ("posted_at");