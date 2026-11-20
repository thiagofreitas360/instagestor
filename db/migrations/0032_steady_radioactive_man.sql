CREATE TYPE "public"."sale_event_type" AS ENUM('LEAD', 'PIX', 'SALE', 'UPSELL');--> statement-breakpoint
CREATE TABLE "sales_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"event_type" "sale_event_type" NOT NULL,
	"external_id" text,
	"amount_cents" integer,
	"product_name" text,
	"raw_event" text,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sales_events_amount_valid" CHECK ("sales_events"."amount_cents" IS NULL OR "sales_events"."amount_cents" >= 0)
);
--> statement-breakpoint
CREATE TABLE "sales_webhooks" (
	"organization_id" uuid PRIMARY KEY NOT NULL,
	"token_hash" text NOT NULL,
	"encrypted_token" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"rotated_at" timestamp with time zone,
	CONSTRAINT "sales_webhooks_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "revenue_goal_cents" integer;--> statement-breakpoint
ALTER TABLE "sales_events" ADD CONSTRAINT "sales_events_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_webhooks" ADD CONSTRAINT "sales_webhooks_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "sales_events_dedup_idx" ON "sales_events" USING btree ("organization_id","external_id","event_type") WHERE "sales_events"."external_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "sales_events_org_occurred_idx" ON "sales_events" USING btree ("organization_id","occurred_at");--> statement-breakpoint
ALTER TABLE "settings" ADD CONSTRAINT "settings_revenue_goal_valid" CHECK ("settings"."revenue_goal_cents" IS NULL OR "settings"."revenue_goal_cents" >= 0);