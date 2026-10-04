CREATE TABLE "meta_apps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"app_id" text NOT NULL,
	"encrypted_app_secret" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "meta_apps_organization_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "meta_apps_organization_app_id_unique" UNIQUE("organization_id","app_id"),
	CONSTRAINT "meta_apps_name_valid" CHECK (length(trim("meta_apps"."name")) BETWEEN 1 AND 60),
	CONSTRAINT "meta_apps_app_id_valid" CHECK ("meta_apps"."app_id" ~ '^[0-9]{10,20}$')
);
--> statement-breakpoint
ALTER TABLE "instagram_accounts" ADD COLUMN "meta_app_id" uuid;--> statement-breakpoint
ALTER TABLE "oauth_states" ADD COLUMN "meta_app_id" uuid;--> statement-breakpoint
ALTER TABLE "meta_apps" ADD CONSTRAINT "meta_apps_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "instagram_accounts" ADD CONSTRAINT "instagram_accounts_meta_app_id_meta_apps_id_fk" FOREIGN KEY ("meta_app_id") REFERENCES "public"."meta_apps"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_states" ADD CONSTRAINT "oauth_states_meta_app_fk" FOREIGN KEY ("organization_id","meta_app_id") REFERENCES "public"."meta_apps"("organization_id","id") ON DELETE cascade ON UPDATE no action;