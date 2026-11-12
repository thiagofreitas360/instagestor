CREATE TABLE "highlight_checkers" (
	"organization_id" uuid PRIMARY KEY NOT NULL,
	"key_hash" text,
	"seen_at" timestamp with time zone,
	"run_started_at" timestamp with time zone,
	"run_finished_at" timestamp with time zone,
	"run_total" integer DEFAULT 0 NOT NULL,
	"run_error" text,
	CONSTRAINT "highlight_checkers_key_hash_unique" UNIQUE("key_hash")
);
--> statement-breakpoint
ALTER TABLE "instagram_accounts" ADD COLUMN "highlight_count" integer;--> statement-breakpoint
ALTER TABLE "instagram_accounts" ADD COLUMN "highlight_checked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "instagram_accounts" ADD COLUMN "highlight_check_error" text;--> statement-breakpoint
ALTER TABLE "highlight_checkers" ADD CONSTRAINT "highlight_checkers_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;