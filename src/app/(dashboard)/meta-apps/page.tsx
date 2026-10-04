import { deleteMetaAppAction, saveMetaAppAction } from "@/app/actions";
import { ConfirmSubmitButton } from "@/components/confirm-submit-button";
import { EmptyState, MessageBanner, PageHeader, Panel } from "@/components/ui";
import { getEnv } from "@/lib/env";
import { requireAdmin } from "@/server/auth";
import { listMetaApps } from "@/server/meta-apps";

type PageProps = { searchParams: Promise<{ erro?: string | string[]; ok?: string | string[] }> };

function first(value?: string | string[]) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function MetaAppsPage({ searchParams }: PageProps) {
  const user = await requireAdmin();
  const [apps, query] = await Promise.all([listMetaApps(user.organizationId), searchParams]);
  const env = getEnv();
  const redirectUri = env.INSTAGRAM_REDIRECT_URI ?? `${env.APP_URL}/api/instagram/oauth/callback`;

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Canais"
        title="Meta Apps"
        description="Cadastre os apps do Meta for Developers deste cliente e distribua as contas do Instagram entre eles. Cada conta fica vinculada ao app pelo qual foi conectada; publicações, loops e métricas funcionam igual."
      />
      <MessageBanner error={first(query.erro)} success={first(query.ok)} />

      <Panel title="Como preparar cada app" description="No painel da Meta, em Instagram › Configuração da API com login do Instagram.">
        <div className="form-stack">
          <ol className="meta-app-steps">
            <li>Copie o <strong>Instagram App ID</strong> e o <strong>Instagram App Secret</strong>, não o ID do app Meta do topo da página.</li>
            <li>Em <strong>Configurar o login comercial do Instagram</strong>, cadastre exatamente a URL abaixo como URI de redirecionamento.</li>
            <li>Em <strong>Funções do app</strong>, adicione a conta como <strong>Testador do Instagram</strong> e aceite o convite no Instagram (Configurações › Apps e sites).</li>
          </ol>
          <label>
            URL de redirecionamento OAuth
            <input className="credential-input" type="text" value={redirectUri} readOnly />
          </label>
        </div>
      </Panel>

      <div className="tenant-admin-layout">
        <Panel className="tenant-create-panel sticky-panel" title="Novo app" description="O secret fica criptografado e nunca volta para a tela.">
          <form className="form-stack" action={saveMetaAppAction}>
            <label>
              Nome (apelido)
              <input name="name" type="text" maxLength={60} placeholder="Ex.: App principal" required />
            </label>
            <label>
              Instagram App ID
              <input name="appId" type="text" inputMode="numeric" pattern="\d{10,20}" placeholder="Ex.: 1234567890123456" required />
            </label>
            <label>
              Instagram App Secret
              <input name="appSecret" type="password" autoComplete="off" placeholder="Cole o secret aqui" required />
            </label>
            <button className="button button-primary button-block" type="submit">Criar app</button>
          </form>
        </Panel>

        <Panel
          title={`Apps cadastrados (${apps.length})`}
          description="Remover um app não desconecta as contas: elas continuam publicando, só perdem o vínculo exibido."
        >
          {apps.length ? (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th scope="col">App</th>
                    <th scope="col">Contas</th>
                    <th scope="col" className="table-action-column">Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {apps.map((app) => (
                    <tr key={app.id}>
                      <td data-label="App">
                        <strong className="table-main-value">{app.name}</strong>
                        <small>Instagram App ID: {app.app_id}</small>
                      </td>
                      <td data-label="Contas">
                        <span className="table-main-value">{app.account_count} conta(s)</span>
                      </td>
                      <td className="table-action-column" data-label="Ações">
                        <div className="tenant-actions">
                          <details className="native-disclosure tenant-password-reset">
                            <summary>Editar</summary>
                            <form action={saveMetaAppAction}>
                              <input type="hidden" name="id" value={app.id} />
                              <label>
                                Nome (apelido)
                                <input name="name" type="text" maxLength={60} defaultValue={app.name} required />
                              </label>
                              <label>
                                Instagram App ID
                                <input name="appId" type="text" inputMode="numeric" pattern="\d{10,20}" defaultValue={app.app_id} required />
                              </label>
                              <label>
                                Instagram App Secret <span className="optional-label">deixe em branco para manter</span>
                                <input name="appSecret" type="password" autoComplete="off" placeholder="••••••••" />
                              </label>
                              <button className="button button-primary button-small button-block" type="submit">Salvar</button>
                            </form>
                          </details>
                          <form action={deleteMetaAppAction}>
                            <input type="hidden" name="id" value={app.id} />
                            <ConfirmSubmitButton
                              className="button button-small button-quiet-danger"
                              message={`Remover o app "${app.name}"? As ${app.account_count} conta(s) conectadas por ele continuam publicando, mas novas conexões não poderão usá-lo.`}
                            >
                              Remover
                            </ConfirmSubmitButton>
                          </form>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState
              title="Nenhum Meta App cadastrado"
              description="Enquanto não houver apps próprios, as conexões usam o app central do InstaGestor."
            />
          )}
        </Panel>
      </div>
    </div>
  );
}
