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
  organizationId: string;
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
      WHERE organization_id = ${input.organizationId}
        AND id = ANY(${mediaIds}::uuid[]) AND processing_status = 'READY' AND deleted_at IS NULL
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
      INSERT INTO campaigns (organization_id, name, publication_type, caption, share_to_feed, created_by)
      VALUES (${input.organizationId}, ${name}, ${input.publicationType}, ${input.caption?.trim() || null}, ${input.publicationType === "REEL" && (input.shareToFeed ?? false)}, ${input.actorUserId})
      RETURNING id
    `;
    const rows = orderedMedia.map((asset, position) => ({
      organization_id: input.organizationId,
      campaign_id: campaign.id,
      media_asset_id: asset.id,
      position,
    }));
    await sql`INSERT INTO campaign_media ${sql(rows)}`;
    await sql`
      INSERT INTO audit_logs (organization_id, actor_user_id, event_type, entity_type, entity_id)
      VALUES (${input.organizationId}, ${input.actorUserId}, 'CAMPAIGN_CREATED', 'campaign', ${campaign.id})
    `;
    return campaign.id;
  });
}

export async function resolveTargetIds(input: {
  organizationId: string;
  accountIds?: string[];
  groupIds?: string[];
  all?: boolean;
}) {
  const accountIds = input.accountIds ?? [];
  const groupIds = input.groupIds ?? [];
  const rows = await getSqlClient()<Array<{ id: string; group_ids: string[] }>>`
    SELECT account.id,
      coalesce(array_agg(member.group_id::text) FILTER (WHERE member.group_id IS NOT NULL), '{}') AS group_ids
    FROM instagram_accounts account
    LEFT JOIN account_group_members member ON member.organization_id = account.organization_id
      AND member.instagram_account_id = account.id
    WHERE account.organization_id = ${input.organizationId}
      AND account.status IN ('CONNECTED', 'TOKEN_EXPIRING')
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

export async function createGroup(
  name: string,
  description: string | undefined,
  actorUserId: string,
  organizationId: string,
  color = "#4f46e5",
) {
  const normalized = name.trim();
  if (!/^#[0-9a-fA-F]{6}$/.test(color)) throw new Error("Cor do grupo invalida");
  if (!normalized) throw new Error("Nome do grupo é obrigatório");
  return getSqlClient().begin(async (sql) => {
    const [group] = await sql<{ id: string }[]>`
      INSERT INTO account_groups (organization_id, name, description, color)
      VALUES (${organizationId}, ${normalized}, ${description?.trim() || null}, ${color}) RETURNING id
    `;
    await sql`
      INSERT INTO audit_logs (organization_id, actor_user_id, event_type, entity_type, entity_id)
      VALUES (${organizationId}, ${actorUserId}, 'GROUP_CREATED', 'account_group', ${group.id})
    `;
    return group.id;
  });
}

export async function updateGroup(
  groupId: string,
  name: string,
  description: string | undefined,
  actorUserId: string,
  organizationId: string,
  color = "#4f46e5",
) {
  const normalized = name.trim();
  const normalizedDescription = description?.trim() || null;
  if (!normalized) throw new Error("Nome do grupo é obrigatório");
  if (normalized.length > 120) throw new Error("Nome do grupo excede 120 caracteres");
  if (normalizedDescription && normalizedDescription.length > 500) {
    throw new Error("Descrição do grupo excede 500 caracteres");
  }

  if (!/^#[0-9a-fA-F]{6}$/.test(color)) throw new Error("Cor do grupo invalida");

  await getSqlClient().begin(async (sql) => {
    const [group] = await sql<{ id: string }[]>`
      SELECT id FROM account_groups WHERE organization_id = ${organizationId} AND id = ${groupId} FOR UPDATE
    `;
    if (!group) throw new Error("Grupo não encontrado");

    await sql`
      UPDATE account_groups
      SET name = ${normalized}, description = ${normalizedDescription}, color = ${color}, updated_at = now()
      WHERE organization_id = ${organizationId} AND id = ${groupId}
    `;
    await sql`
      INSERT INTO audit_logs (organization_id, actor_user_id, event_type, entity_type, entity_id, metadata_json)
      VALUES (${organizationId}, ${actorUserId}, 'GROUP_UPDATED', 'account_group', ${groupId},
        jsonb_build_object('fields', ARRAY['name', 'description', 'color']))
    `;
  });
}

export async function replaceGroupMembers(groupId: string, accountIds: string[], organizationId: string) {
  const uniqueIds = [...new Set(accountIds)];
  await getSqlClient().begin(async (sql) => {
    const [group] = await sql<{ id: string }[]>`
      SELECT id FROM account_groups WHERE organization_id = ${organizationId} AND id = ${groupId} FOR UPDATE
    `;
    if (!group) throw new Error("Grupo não encontrado");
    if (uniqueIds.length) {
      const [{ count }] = await sql<Array<{ count: number }>>`
        SELECT count(*)::int AS count FROM instagram_accounts
        WHERE organization_id = ${organizationId} AND id = ANY(${uniqueIds}::uuid[])
      `;
      if (count !== uniqueIds.length) throw new Error("Uma ou mais contas não pertencem à organização");
    }
    await sql`DELETE FROM account_group_members WHERE organization_id = ${organizationId} AND group_id = ${groupId}`;
    if (uniqueIds.length) {
      await sql`
        INSERT INTO account_group_members ${sql(uniqueIds.map((id) => ({
          organization_id: organizationId,
          group_id: groupId,
          instagram_account_id: id,
        })))}
      `;
    }
  });
}

export async function deleteGroup(groupId: string, organizationId: string) {
  await getSqlClient()`DELETE FROM account_groups WHERE organization_id = ${organizationId} AND id = ${groupId}`;
}
