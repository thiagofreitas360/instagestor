import { createGroupAction, deleteGroupAction, updateGroupAction, updateGroupMembersAction } from "@/app/actions";
import { getSqlClient } from "@/db/client";
import { EmptyState, MessageBanner, PageHeader, Panel, StatusBadge, initials } from "@/components/ui";

type GroupRow = { id: string; name: string; description: string | null; member_count: number };
type AccountRow = { id: string; username: string; display_name: string | null; status: string };
type Membership = { group_id: string; instagram_account_id: string };
type PageProps = { searchParams: Promise<{ erro?: string | string[]; ok?: string | string[] }> };

function first(value?: string | string[]) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function GroupsPage({ searchParams }: PageProps) {
  const query = await searchParams;
  const sql = getSqlClient();
  const [groups, accounts, memberships] = await Promise.all([
    sql<GroupRow[]>`
      SELECT group_row.id, group_row.name, group_row.description,
        count(member.instagram_account_id)::int AS member_count
      FROM account_groups group_row
      LEFT JOIN account_group_members member ON member.group_id = group_row.id
      GROUP BY group_row.id
      ORDER BY group_row.name
    `,
    sql<AccountRow[]>`
      SELECT id, username, display_name, status
      FROM instagram_accounts
      ORDER BY CASE WHEN status IN ('CONNECTED', 'TOKEN_EXPIRING') THEN 0 ELSE 1 END, username
    `,
    sql<Membership[]>`SELECT group_id, instagram_account_id FROM account_group_members`,
  ]);
  const membersByGroup = new Map<string, Set<string>>();
  for (const membership of memberships) {
    const current = membersByGroup.get(membership.group_id) ?? new Set<string>();
    current.add(membership.instagram_account_id);
    membersByGroup.set(membership.group_id, current);
  }

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Segmentação"
        title="Grupos de contas"
        description="Organize contas para selecionar públicos inteiros ao agendar uma campanha."
      />
      <MessageBanner error={first(query.erro)} success={first(query.ok)} />

      <section className="groups-layout">
        <Panel title="Novo grupo" description="Use um nome curto e reconhecível pela equipe." className="sticky-panel">
          <form className="form-stack" action={createGroupAction}>
            <label>
              Nome do grupo
              <input name="name" type="text" maxLength={120} placeholder="Ex.: Lojas — Sudeste" required />
            </label>
            <label>
              Descrição <span className="optional-label">opcional</span>
              <textarea name="description" rows={3} maxLength={500} placeholder="Quando este grupo deve ser usado" />
            </label>
            <button className="button button-primary button-block" type="submit">Criar grupo</button>
          </form>
        </Panel>

        <div className="group-card-list">
          {groups.length ? groups.map((group) => {
            const selected = membersByGroup.get(group.id) ?? new Set<string>();
            return (
              <article className="group-card panel" key={group.id}>
                <header className="group-card-header">
                  <div>
                    <h2>{group.name}</h2>
                    <p>{group.description ?? "Sem descrição"}</p>
                  </div>
                  <span className="count-pill">{group.member_count} {group.member_count === 1 ? "conta" : "contas"}</span>
                </header>

                {group.member_count ? (
                  <div className="avatar-stack" aria-label={`${group.member_count} membros`}>
                    {accounts.filter((account) => selected.has(account.id)).slice(0, 6).map((account) => (
                      <span className="account-avatar" title={`@${account.username}`} key={account.id}>
                        {initials(account.display_name ?? account.username)}
                      </span>
                    ))}
                    {group.member_count > 6 ? <span className="account-avatar avatar-more">+{group.member_count - 6}</span> : null}
                  </div>
                ) : <p className="panel-placeholder">Nenhuma conta adicionada.</p>}

                <details className="native-disclosure group-details-editor">
                  <summary>Editar nome e descrição</summary>
                  <form className="member-form" action={updateGroupAction}>
                    <input type="hidden" name="groupId" value={group.id} />
                    <label>
                      Nome do grupo
                      <input name="name" type="text" maxLength={120} defaultValue={group.name} required />
                    </label>
                    <label>
                      Descrição <span className="optional-label">opcional</span>
                      <textarea name="description" rows={3} maxLength={500} defaultValue={group.description ?? ""} />
                    </label>
                    <button className="button button-secondary" type="submit">Salvar informações</button>
                  </form>
                </details>

                <details className="native-disclosure">
                  <summary>Editar membros</summary>
                  <form className="member-form" action={updateGroupMembersAction}>
                    <input type="hidden" name="groupId" value={group.id} />
                    {accounts.length ? (
                      <fieldset className="checkbox-list">
                        <legend className="sr-only">Contas do grupo {group.name}</legend>
                        {accounts.map((account) => (
                          <label className="checkbox-row" key={account.id}>
                            <input
                              type="checkbox"
                              name="accountIds"
                              value={account.id}
                              defaultChecked={selected.has(account.id)}
                            />
                            <span className="account-avatar account-avatar-small" aria-hidden="true">
                              {initials(account.display_name ?? account.username)}
                            </span>
                            <span className="checkbox-row-copy">
                              <strong>{account.display_name ?? `@${account.username}`}</strong>
                              <small>@{account.username}</small>
                            </span>
                            <StatusBadge status={account.status} />
                          </label>
                        ))}
                      </fieldset>
                    ) : (
                      <EmptyState title="Nenhuma conta disponível" description="Conecte contas antes de montar este grupo." />
                    )}
                    <button className="button button-primary" type="submit">Salvar membros</button>
                  </form>
                </details>

                <footer className="group-card-footer">
                  <span>Excluir o grupo não desconecta as contas.</span>
                  <form action={deleteGroupAction}>
                    <input type="hidden" name="groupId" value={group.id} />
                    <button className="button button-small button-quiet-danger" type="submit">Excluir grupo</button>
                  </form>
                </footer>
              </article>
            );
          }) : (
            <Panel>
              <EmptyState title="Nenhum grupo criado" description="Crie o primeiro grupo para acelerar a seleção de contas nas campanhas." />
            </Panel>
          )}
        </div>
      </section>
    </div>
  );
}
