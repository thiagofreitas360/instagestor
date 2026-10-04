CREATE TYPE "public"."organization_member_role" AS ENUM('OWNER', 'ADMIN', 'MEMBER');--> statement-breakpoint
CREATE TYPE "public"."organization_status" AS ENUM('ACTIVE', 'SUSPENDED');--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"status" "organization_status" DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organizations_slug_unique" UNIQUE("slug"),
	CONSTRAINT "organizations_name_valid" CHECK (length(trim("organizations"."name")) BETWEEN 1 AND 120),
	CONSTRAINT "organizations_slug_valid" CHECK ("organizations"."slug" ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$')
);--> statement-breakpoint
CREATE TABLE "organization_members" (
	"organization_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "organization_member_role" DEFAULT 'MEMBER' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organization_members_organization_id_user_id_pk" PRIMARY KEY("organization_id","user_id")
);--> statement-breakpoint
INSERT INTO "organizations" ("id", "name", "slug")
VALUES ('00000000-0000-4000-8000-000000000001', 'InstaGestor', 'instagestor');--> statement-breakpoint
INSERT INTO "organization_members" ("organization_id", "user_id", "role")
SELECT '00000000-0000-4000-8000-000000000001', "id", 'OWNER' FROM "users";--> statement-breakpoint
ALTER TABLE "account_groups" DROP CONSTRAINT "account_groups_name_unique";--> statement-breakpoint
ALTER TABLE "settings" DROP CONSTRAINT "settings_singleton";--> statement-breakpoint
ALTER TABLE "settings" DROP CONSTRAINT "settings_pkey";--> statement-breakpoint
DROP INDEX "account_daily_metrics_day_idx";--> statement-breakpoint
DROP INDEX "account_media_account_posted_idx";--> statement-breakpoint
DROP INDEX "account_media_posted_idx";--> statement-breakpoint
DROP INDEX "audit_logs_created_idx";--> statement-breakpoint
DROP INDEX "campaigns_status_idx";--> statement-breakpoint
DROP INDEX "instagram_accounts_status_idx";--> statement-breakpoint
DROP INDEX "media_assets_status_idx";--> statement-breakpoint
DROP INDEX "media_assets_folder_idx";--> statement-breakpoint
DROP INDEX "media_folders_name_unique";--> statement-breakpoint
DROP INDEX "publication_jobs_status_scheduled_idx";--> statement-breakpoint
DROP INDEX "publication_jobs_status_retry_idx";--> statement-breakpoint
DROP INDEX "publication_jobs_account_idx";--> statement-breakpoint
DROP INDEX "publication_jobs_campaign_idx";--> statement-breakpoint
ALTER TABLE "account_daily_metrics" ADD COLUMN "organization_id" uuid;--> statement-breakpoint
ALTER TABLE "account_group_members" ADD COLUMN "organization_id" uuid;--> statement-breakpoint
ALTER TABLE "account_groups" ADD COLUMN "organization_id" uuid;--> statement-breakpoint
ALTER TABLE "account_media" ADD COLUMN "organization_id" uuid;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD COLUMN "organization_id" uuid;--> statement-breakpoint
ALTER TABLE "campaign_media" ADD COLUMN "organization_id" uuid;--> statement-breakpoint
ALTER TABLE "campaign_targets" ADD COLUMN "organization_id" uuid;--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "organization_id" uuid;--> statement-breakpoint
ALTER TABLE "instagram_accounts" ADD COLUMN "organization_id" uuid;--> statement-breakpoint
ALTER TABLE "media_assets" ADD COLUMN "organization_id" uuid;--> statement-breakpoint
ALTER TABLE "media_folders" ADD COLUMN "organization_id" uuid;--> statement-breakpoint
ALTER TABLE "oauth_states" ADD COLUMN "organization_id" uuid;--> statement-breakpoint
ALTER TABLE "oauth_states" ADD COLUMN "initiated_by" uuid;--> statement-breakpoint
ALTER TABLE "publication_jobs" ADD COLUMN "organization_id" uuid;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "organization_id" uuid;--> statement-breakpoint
UPDATE "instagram_accounts" SET "organization_id" = '00000000-0000-4000-8000-000000000001';--> statement-breakpoint
UPDATE "account_groups" SET "organization_id" = '00000000-0000-4000-8000-000000000001';--> statement-breakpoint
UPDATE "media_folders" SET "organization_id" = '00000000-0000-4000-8000-000000000001';--> statement-breakpoint
UPDATE "media_assets" SET "organization_id" = '00000000-0000-4000-8000-000000000001';--> statement-breakpoint
UPDATE "campaigns" SET "organization_id" = '00000000-0000-4000-8000-000000000001';--> statement-breakpoint
UPDATE "account_group_members" member SET "organization_id" = account."organization_id"
FROM "instagram_accounts" account WHERE account."id" = member."instagram_account_id";--> statement-breakpoint
UPDATE "campaign_media" relation SET "organization_id" = campaign."organization_id"
FROM "campaigns" campaign WHERE campaign."id" = relation."campaign_id";--> statement-breakpoint
UPDATE "campaign_targets" target SET "organization_id" = campaign."organization_id"
FROM "campaigns" campaign WHERE campaign."id" = target."campaign_id";--> statement-breakpoint
UPDATE "publication_jobs" job SET "organization_id" = campaign."organization_id"
FROM "campaigns" campaign WHERE campaign."id" = job."campaign_id";--> statement-breakpoint
UPDATE "account_daily_metrics" metric SET "organization_id" = account."organization_id"
FROM "instagram_accounts" account WHERE account."id" = metric."instagram_account_id";--> statement-breakpoint
UPDATE "account_media" media SET "organization_id" = account."organization_id"
FROM "instagram_accounts" account WHERE account."id" = media."instagram_account_id";--> statement-breakpoint
UPDATE "audit_logs" SET "organization_id" = '00000000-0000-4000-8000-000000000001';--> statement-breakpoint
DELETE FROM "oauth_states" WHERE NOT EXISTS (SELECT 1 FROM "users");--> statement-breakpoint
UPDATE "oauth_states" SET
	"organization_id" = '00000000-0000-4000-8000-000000000001',
	"initiated_by" = (SELECT "id" FROM "users" ORDER BY "created_at" LIMIT 1);--> statement-breakpoint
UPDATE "settings" SET "organization_id" = '00000000-0000-4000-8000-000000000001';--> statement-breakpoint
ALTER TABLE "account_daily_metrics" ALTER COLUMN "organization_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "account_group_members" ALTER COLUMN "organization_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "account_groups" ALTER COLUMN "organization_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "account_media" ALTER COLUMN "organization_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "campaign_media" ALTER COLUMN "organization_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "campaign_targets" ALTER COLUMN "organization_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "campaigns" ALTER COLUMN "organization_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "instagram_accounts" ALTER COLUMN "organization_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "media_assets" ALTER COLUMN "organization_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "media_folders" ALTER COLUMN "organization_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "oauth_states" ALTER COLUMN "organization_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "oauth_states" ALTER COLUMN "initiated_by" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "publication_jobs" ALTER COLUMN "organization_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ALTER COLUMN "organization_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" DROP COLUMN "id";--> statement-breakpoint
ALTER TABLE "settings" ADD CONSTRAINT "settings_pkey" PRIMARY KEY("organization_id");--> statement-breakpoint
ALTER TABLE "organization_members" ADD CONSTRAINT "organization_members_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_members" ADD CONSTRAINT "organization_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "organization_members_user_idx" ON "organization_members" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "account_daily_metrics" ADD CONSTRAINT "account_daily_metrics_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_group_members" ADD CONSTRAINT "account_group_members_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_groups" ADD CONSTRAINT "account_groups_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_media" ADD CONSTRAINT "account_media_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_media" ADD CONSTRAINT "campaign_media_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_targets" ADD CONSTRAINT "campaign_targets_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "instagram_accounts" ADD CONSTRAINT "instagram_accounts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_folders" ADD CONSTRAINT "media_folders_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_states" ADD CONSTRAINT "oauth_states_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_states" ADD CONSTRAINT "oauth_states_initiated_by_users_id_fk" FOREIGN KEY ("initiated_by") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publication_jobs" ADD CONSTRAINT "publication_jobs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settings" ADD CONSTRAINT "settings_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_daily_metrics_organization_day_idx" ON "account_daily_metrics" USING btree ("organization_id","day");--> statement-breakpoint
CREATE INDEX "account_group_members_organization_idx" ON "account_group_members" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "account_groups_organization_name_unique" ON "account_groups" USING btree ("organization_id",lower("name"));--> statement-breakpoint
CREATE INDEX "account_media_organization_account_posted_idx" ON "account_media" USING btree ("organization_id","instagram_account_id","posted_at");--> statement-breakpoint
CREATE INDEX "account_media_organization_posted_idx" ON "account_media" USING btree ("organization_id","posted_at");--> statement-breakpoint
CREATE INDEX "audit_logs_organization_created_idx" ON "audit_logs" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "campaigns_organization_status_idx" ON "campaigns" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "instagram_accounts_organization_status_idx" ON "instagram_accounts" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "instagram_accounts_organization_username_idx" ON "instagram_accounts" USING btree ("organization_id","username");--> statement-breakpoint
CREATE INDEX "media_assets_organization_status_idx" ON "media_assets" USING btree ("organization_id","processing_status");--> statement-breakpoint
CREATE INDEX "media_assets_organization_folder_idx" ON "media_assets" USING btree ("organization_id","folder_id");--> statement-breakpoint
CREATE UNIQUE INDEX "media_folders_organization_name_unique" ON "media_folders" USING btree ("organization_id",lower("name"));--> statement-breakpoint
CREATE INDEX "publication_jobs_organization_status_scheduled_idx" ON "publication_jobs" USING btree ("organization_id","status","scheduled_at");--> statement-breakpoint
CREATE INDEX "publication_jobs_organization_status_retry_idx" ON "publication_jobs" USING btree ("organization_id","status","next_attempt_at");--> statement-breakpoint
CREATE INDEX "publication_jobs_organization_account_idx" ON "publication_jobs" USING btree ("organization_id","instagram_account_id");--> statement-breakpoint
CREATE INDEX "publication_jobs_organization_campaign_idx" ON "publication_jobs" USING btree ("organization_id","campaign_id");
