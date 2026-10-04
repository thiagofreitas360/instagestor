import { getSqlClient } from "@/db/client";
import { decryptToken, encryptToken } from "@/lib/crypto";
import { OauthFlowError } from "@/lib/oauth-result";
import { audit } from "./auth";

export type MetaAppOption = { id: string; name: string; account_count: number };
export type MetaAppRow = MetaAppOption & { app_id: string };

/** Nunca devolve o secret: só nome, App ID e quantas contas cada app conectou. */
export function listMetaApps(organizationId: string) {
  return getSqlClient()<MetaAppRow[]>`
    SELECT app.id, app.name, app.app_id,
      (SELECT count(*)::int FROM instagram_accounts account
        WHERE account.organization_id = app.organization_id AND account.meta_app_id = app.id) AS account_count
    FROM meta_apps app
    WHERE app.organization_id = ${organizationId}
    ORDER BY app.name, app.created_at
  `;
}

/** Cria (sem id) ou edita um app; na edição, secret vazio mantém o atual. */
export async function saveMetaApp(
  organizationId: string,
  actorUserId: string,
  input: { id?: string; name: string; appId: string; appSecret?: string },
) {
  const secret = input.appSecret ? encryptToken(input.appSecret) : null;
  const sql = getSqlClient();
  try {
    const [saved] = input.id
      ? await sql<{ id: string }[]>`
          UPDATE meta_apps SET name = ${input.name}, app_id = ${input.appId},
            encrypted_app_secret = COALESCE(${secret}, encrypted_app_secret), updated_at = now()
          WHERE organization_id = ${organizationId} AND id = ${input.id}
          RETURNING id
        `
      : await sql<{ id: string }[]>`
          INSERT INTO meta_apps (organization_id, name, app_id, encrypted_app_secret)
          VALUES (${organizationId}, ${input.name}, ${input.appId}, ${secret})
          RETURNING id
        `;
    if (!saved) throw new Error("Meta App não encontrado");
    await audit(organizationId, actorUserId, input.id ? "META_APP_UPDATED" : "META_APP_CREATED", "meta_app", saved.id, {
      appId: input.appId,
    });
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "23505") {
      throw new Error("Este App ID já está cadastrado");
    }
    throw error;
  }
}

/** As contas conectadas pelo app seguem publicando: o token não depende do cadastro aqui. */
export async function deleteMetaApp(organizationId: string, actorUserId: string, id: string) {
  const deleted = await getSqlClient()`
    DELETE FROM meta_apps WHERE organization_id = ${organizationId} AND id = ${id} RETURNING id
  `;
  if (!deleted.length) throw new Error("Meta App não encontrado");
  await audit(organizationId, actorUserId, "META_APP_DELETED", "meta_app", id);
}

export async function getMetaAppCredentials(organizationId: string, id: string) {
  const [app] = await getSqlClient()<{ app_id: string; encrypted_app_secret: string }[]>`
    SELECT app_id, encrypted_app_secret FROM meta_apps WHERE organization_id = ${organizationId} AND id = ${id}
  `;
  if (!app) throw new OauthFlowError("connection_failed", "Meta App da conexão não encontrado");
  return { appId: app.app_id, appSecret: decryptToken(app.encrypted_app_secret) };
}
