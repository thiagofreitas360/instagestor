ALTER TABLE "loops" ADD COLUMN "media_folder_id" uuid;--> statement-breakpoint
UPDATE "loops" AS loop
SET "media_folder_id" = inferred.folder_id
FROM (
	SELECT selected.loop_id,
		(array_agg(DISTINCT asset.folder_id) FILTER (WHERE asset.folder_id IS NOT NULL))[1] AS folder_id
	FROM "loop_media" AS selected
	JOIN "media_assets" AS asset
		ON asset.organization_id = selected.organization_id AND asset.id = selected.media_asset_id
	GROUP BY selected.loop_id
	HAVING count(*) = count(asset.folder_id) AND count(DISTINCT asset.folder_id) = 1
) AS inferred
WHERE loop.id = inferred.loop_id;--> statement-breakpoint
ALTER TABLE "loops" ADD CONSTRAINT "loops_organization_media_folder_fk" FOREIGN KEY ("organization_id","media_folder_id") REFERENCES "public"."media_folders"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "loops_organization_media_folder_idx" ON "loops" USING btree ("organization_id","media_folder_id");--> statement-breakpoint
CREATE TEMP TABLE "duplicate_loop_accounts" ON COMMIT DROP AS
SELECT organization_id, loop_id, instagram_account_id
FROM (
	SELECT selected.organization_id, selected.loop_id, selected.instagram_account_id,
		row_number() OVER (
			PARTITION BY selected.organization_id, selected.instagram_account_id
			ORDER BY selected.created_at, loop.created_at, selected.loop_id
		) AS assignment_order
	FROM "loop_accounts" AS selected
	JOIN "loops" AS loop
		ON loop.organization_id = selected.organization_id AND loop.id = selected.loop_id
) AS ranked
WHERE assignment_order > 1;--> statement-breakpoint
UPDATE "publication_jobs" AS job
SET status = 'CANCELLED', finished_at = now(), updated_at = now()
FROM "duplicate_loop_accounts" AS duplicate
WHERE job.organization_id = duplicate.organization_id
	AND job.loop_id = duplicate.loop_id
	AND job.instagram_account_id = duplicate.instagram_account_id
	AND job.status IN ('DRAFT', 'QUEUED', 'RETRY_WAIT');--> statement-breakpoint
DELETE FROM "loop_account_state" AS state
USING "duplicate_loop_accounts" AS duplicate
WHERE state.organization_id = duplicate.organization_id
	AND state.loop_id = duplicate.loop_id
	AND state.instagram_account_id = duplicate.instagram_account_id;--> statement-breakpoint
DELETE FROM "campaign_targets" AS target
USING "duplicate_loop_accounts" AS duplicate, "loops" AS loop
WHERE loop.organization_id = duplicate.organization_id
	AND loop.id = duplicate.loop_id
	AND target.organization_id = duplicate.organization_id
	AND target.campaign_id = loop.campaign_id
	AND target.instagram_account_id = duplicate.instagram_account_id;--> statement-breakpoint
INSERT INTO "audit_logs" (organization_id, event_type, entity_type, entity_id, metadata_json)
SELECT duplicate.organization_id, 'LOOP_ACCOUNT_CONFLICT_RESOLVED', 'loop', duplicate.loop_id,
	jsonb_build_object('accountId', duplicate.instagram_account_id, 'keptOldestAssignment', true)
FROM "duplicate_loop_accounts" AS duplicate;--> statement-breakpoint
DELETE FROM "loop_accounts" AS selected
USING "duplicate_loop_accounts" AS duplicate
WHERE selected.organization_id = duplicate.organization_id
	AND selected.loop_id = duplicate.loop_id
	AND selected.instagram_account_id = duplicate.instagram_account_id;--> statement-breakpoint
UPDATE "loops" AS loop
SET status = 'PAUSED', updated_at = now()
WHERE loop.id IN (SELECT DISTINCT loop_id FROM "duplicate_loop_accounts")
	AND NOT EXISTS (
		SELECT 1 FROM "loop_accounts" AS selected
		WHERE selected.organization_id = loop.organization_id AND selected.loop_id = loop.id
	);--> statement-breakpoint
UPDATE "campaigns" AS campaign
SET status = 'PAUSED', paused_at = now(), updated_at = now()
FROM "loops" AS loop
WHERE loop.campaign_id = campaign.id AND loop.status = 'PAUSED'
	AND loop.id IN (SELECT DISTINCT loop_id FROM "duplicate_loop_accounts");--> statement-breakpoint
ALTER TABLE "loop_accounts" ADD CONSTRAINT "loop_accounts_organization_account_unique" UNIQUE("organization_id","instagram_account_id");
