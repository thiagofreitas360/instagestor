ALTER TABLE "instagram_accounts" ADD COLUMN "warmup_profile" text;--> statement-breakpoint
ALTER TABLE "instagram_accounts" ALTER COLUMN "warmup_profile" SET DEFAULT 'BALANCED';--> statement-breakpoint
UPDATE "instagram_accounts" SET "warmup_profile" = 'BALANCED' WHERE "is_new_account" = true;--> statement-breakpoint
ALTER TABLE "publication_jobs" ADD COLUMN "warmup_daily_limit" integer;--> statement-breakpoint
ALTER TABLE "instagram_accounts" ADD CONSTRAINT "instagram_accounts_warmup_profile_valid" CHECK ("instagram_accounts"."warmup_profile" IS NULL OR "instagram_accounts"."warmup_profile" IN ('FAST', 'BALANCED', 'CONSERVATIVE'));
