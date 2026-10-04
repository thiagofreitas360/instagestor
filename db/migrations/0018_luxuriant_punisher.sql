ALTER TABLE "users" ADD COLUMN "is_platform_admin" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "must_change_password" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "session_version" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
UPDATE "users" SET "is_platform_admin" = true
WHERE "id" = (
	SELECT "member"."user_id"
	FROM "organization_members" "member"
	JOIN "organizations" "organization" ON "organization"."id" = "member"."organization_id"
	WHERE "organization"."slug" = 'instagestor'
	ORDER BY CASE "member"."role" WHEN 'OWNER' THEN 0 WHEN 'ADMIN' THEN 1 ELSE 2 END,
		"member"."created_at", "member"."user_id"
	LIMIT 1
);
