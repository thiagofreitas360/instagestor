import { getSqlClient } from "@/db/client";
import { getEnv } from "@/lib/env";
import { validateCampaignMedia } from "./media-constraints";

export type PublicationType = "FEED_IMAGE" | "FEED_VIDEO" | "REEL" | "STORY_IMAGE" | "STORY_VIDEO" | "CAROUSEL";

function validateCaption(caption?: string) {
  if (!caption) return;
  if (caption.length > 2200) throw new Error("Legenda excede 2.200 caracteres");
  if ((caption.match(/(^|\s)#[\p{L}\p{N}_]+/gu) ?? []).length > 30) throw new Error("Legenda excede 30 hashtags");
  if ((caption.match(/(^|\s)@[\w.]+/g) ?? []).length > 20) throw new Error("Legenda excede 20 menções");
}

export async function createCampaign(input: {
  name: string;
  publicationType: PublicationType;
  caption?: string;
  mediaIds: string[];
  shareToFeed?: boolean;
  actorUserId: string;
}) {
  const name = input.name.trim();
  if (!name) throw new Error("Nome da campanha é obrigatório");
  validateCaption(input.caption);
  if (getEnv().INSTAGRAM_PROVIDER === "meta" && input.publicationType === "FEED_VIDEO") {
    throw new Error("Vídeo isolado no Feed depende de confirmação da Meta; use Reel com compartilhar no Feed");
  }
  const mediaIds = [...new Set(input.mediaIds)];
  return getSqlClient().begin(async (sql) => {
    const media = await sql<
      Array<{
        id: string;
        media_kind: "IMAGE" | "VIDEO";
        size_bytes: number;
        width: number | null;
        height: number | null;
        duration_seconds: number | null;
      }>
    >`
      SELECT id, media_kind, size_bytes, width, height, duration_seconds FROM media_assets
      WHERE id = ANY(${mediaIds}::uuid[]) AND processing_status = 'READY' AND deleted_at IS NULL
      FOR SHARE
    `;
    if (media.length !== mediaIds.length) throw new Error("Uma ou mais mídias não estão prontas");
    const byId = new Map(media.map((asset) => [asset.id, asset]));
    const orderedMedia = mediaIds.map((id) => byId.get(id)!);
    validateCampaignMedia(
      input.publicationType,
      orderedMedia.map((asset) => ({
        mediaKind: asset.media_kind,
        sizeBytes: asset.size_bytes,
        width: asset.width,
        height: asset.height,
        durationSeconds: asset.duration_seconds,
      })),
    );

    const [campaign] = await sql<{ id: string }[]>`
      INSERT INTO campaigns (name, publication_type, caption, share_to_feed, created_by)
      VALUES (${name}, ${input.publicationType}, ${input.caption?.trim() || null}, ${input.shareToFeed ?? false}, ${input.actorUserId})
      RETURNING id
    `;
    const rows = orderedMedia.map((asset, position) => ({ campaign_id: campaign.id, media_asset_id: asset.id, position }));
    await sql`INSERT INTO campaign_media ${sql(rows)}`;
    await sql`
      INSERT INTO audit_logs (actor_user_id, event_type, entity_type, entity_id)
      VALUES (${input.actorUserId}, 'CAMPAIGN_CREATED', 'campaign', ${campaign.id})
    `;
    return campaign.id;
  });
}

export async function resolveTargetIds(input: { accountIds?: string[]; groupIds?: string[]; all?: boolean }) {
  const accountIds = input.accountIds ?? [];
  const groupIds = input.groupIds ?? [];
  const rows = await getSqlClient()<Array<{ id: string; group_ids: string[] }>>`
    SELECT account.id,
      coalesce(array_agg(member.group_id::text) FILTER (WHERE member.group_id IS NOT NULL), '{}') AS group_ids
    FROM instagram_accounts account
    LEFT JOIN account_group_members member ON member.instagram_account_id = account.id
    WHERE account.status IN ('CONNECTED', 'TOKEN_EXPIRING')
      AND (
        ${input.all === true}
        OR account.id = ANY(${accountIds}::uuid[])
        OR member.group_id = ANY(${groupIds}::uuid[])
      )
    GROUP BY account.id
    ORDER BY account.id
  `;
  const available = new Set(rows.map((row) => row.id));
  const ordered = accountIds.filter((accountId) => available.delete(accountId));
  for (const groupId of groupIds) {
    for (const row of rows) {
      if (row.group_ids.includes(groupId) && available.delete(row.id)) ordered.push(row.id);
    }
  }
  if (input.all) ordered.push(...available);
  return ordered;
}

export async function createGroup(name: string, description: string | undefined, actorUserId: string) {
  const normalized = name.trim();
  if (!normalized) throw new Error("Nome do grupo é obrigatório");
  return getSqlClient().begin(async (sql) => {
    const [group] = await sql<{ id: string }[]>`
      INSERT INTO account_groups (name, description) VALUES (${normalized}, ${description?.trim() || null}) RETURNING id
    `;
    await sql`
      INSERT INTO audit_logs (actor_user_id, event_type, entity_type, entity_id)
      VALUES (${actorUserId}, 'GROUP_CREATED', 'account_group', ${group.id})
    `;
    return group.id;
  });
}

export async function updateGroup(
  groupId: string,
  name: string,
  description: string | undefined,
  actorUserId: string,
) {
  const normalized = name.trim();
  const normalizedDescription = description?.trim() || null;
  if (!normalized) throw new Error("Nome do grupo é obrigatório");
  if (normalized.length > 120) throw new Error("Nome do grupo excede 120 caracteres");
  if (normalizedDescription && normalizedDescription.length > 500) {
    throw new Error("Descrição do grupo excede 500 caracteres");
  }

  await getSqlClient().begin(async (sql) => {
    const [group] = await sql<{ id: string }[]>`
      SELECT id FROM account_groups WHERE id = ${groupId} FOR UPDATE
    `;
    if (!group) throw new Error("Grupo não encontrado");

    await sql`
      UPDATE account_groups
      SET name = ${normalized}, description = ${normalizedDescription}, updated_at = now()
      WHERE id = ${groupId}
    `;
    await sql`
      INSERT INTO audit_logs (actor_user_id, event_type, entity_type, entity_id, metadata_json)
      VALUES (${actorUserId}, 'GROUP_UPDATED', 'account_group', ${groupId},
        jsonb_build_object('fields', ARRAY['name', 'description']))
    `;
  });
}

export async function replaceGroupMembers(groupId: string, accountIds: string[]) {
  const uniqueIds = [...new Set(accountIds)];
  await getSqlClient().begin(async (sql) => {
    const [group] = await sql<{ id: string }[]>`SELECT id FROM account_groups WHERE id = ${groupId} FOR UPDATE`;
    if (!group) throw new Error("Grupo não encontrado");
    await sql`DELETE FROM account_group_members WHERE group_id = ${groupId}`;
    if (uniqueIds.length) {
      await sql`
        INSERT INTO account_group_members ${sql(uniqueIds.map((id) => ({ group_id: groupId, instagram_account_id: id })))}
      `;
    }
  });
}

export async function deleteGroup(groupId: string) {
  await getSqlClient()`DELETE FROM account_groups WHERE id = ${groupId}`;
}
