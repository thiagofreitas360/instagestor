import { closeDatabase, getSqlClient } from "../src/db/client";
import { encryptToken } from "../src/lib/crypto";
import { getEnv } from "../src/lib/env";
import { hashPassword } from "../src/server/auth";

async function main() {
  const email = process.env.ADMIN_EMAIL?.toLowerCase().trim();
  const password = process.env.ADMIN_PASSWORD;
  if (!email || !password || password.length < 12) throw new Error("ADMIN_EMAIL e ADMIN_PASSWORD (mínimo 12 caracteres) são obrigatórios");
  const [admin] = await getSqlClient()<{ id: string }[]>`
    INSERT INTO users (email, password_hash, role)
    VALUES (${email}, ${await hashPassword(password)}, 'ADMIN')
    ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash, updated_at = now()
    RETURNING id
  `;

  if (getEnv().INSTAGRAM_PROVIDER === "fake" && getEnv().NODE_ENV !== "production") {
    for (let position = 1; position <= 10; position++) {
      const instagramId = `seed_${position}`;
      await getSqlClient()`
        INSERT INTO instagram_accounts (
          instagram_user_id, app_scoped_user_id, username, display_name, account_type, status,
          encrypted_access_token, token_expires_at, token_last_refreshed_at, granted_scopes
        ) VALUES (
          ${instagramId}, ${`app_${instagramId}`}, ${`conta_teste_${position}`}, ${`Conta Teste ${position}`},
          'BUSINESS', 'CONNECTED', ${encryptToken(`fake-token:${instagramId}:conta_teste_${position}`)},
          now() + interval '60 days', now(), ${["instagram_business_basic", "instagram_business_content_publish", "instagram_business_manage_insights"]}
        ) ON CONFLICT (instagram_user_id) DO NOTHING
      `;
    }
    const [first] = await getSqlClient()<{ id: string }[]>`
      INSERT INTO account_groups (name, description) VALUES ('Lojas', 'Contas de lojas')
      ON CONFLICT (name) DO UPDATE SET description = EXCLUDED.description RETURNING id
    `;
    const [second] = await getSqlClient()<{ id: string }[]>`
      INSERT INTO account_groups (name, description) VALUES ('Campanhas locais', 'Grupo de demonstração')
      ON CONFLICT (name) DO UPDATE SET description = EXCLUDED.description RETURNING id
    `;
    const accounts = await getSqlClient()<Array<{ id: string }>>`
      SELECT id FROM instagram_accounts WHERE instagram_user_id LIKE 'seed_%' ORDER BY instagram_user_id
    `;
    await getSqlClient()`
      INSERT INTO account_group_members ${getSqlClient()(
        accounts.slice(0, 5).map((account) => ({ group_id: first.id, instagram_account_id: account.id })),
      )} ON CONFLICT DO NOTHING
    `;
    await getSqlClient()`
      INSERT INTO account_group_members ${getSqlClient()(
        accounts.slice(5).map((account) => ({ group_id: second.id, instagram_account_id: account.id })),
      )} ON CONFLICT DO NOTHING
    `;
  }
  await getSqlClient()`
    INSERT INTO settings (id, default_timezone) VALUES (true, ${getEnv().DEFAULT_TIMEZONE}) ON CONFLICT (id) DO NOTHING
  `;
  console.log(`Seed concluído para ${admin.id}`);
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(closeDatabase);
