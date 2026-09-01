import Link from "next/link";
import { notFound } from "next/navigation";
import { disconnectAccountAction, verifyAccountAction } from "@/app/actions";
import { getSqlClient } from "@/db/client";
import {
  DefinitionList,
  EmptyState,
  formatDate,
  MessageBanner,
  MetricCard,
  PageHeader,
  Panel,
  StatusBadge,
  initials,
} from "@/components/ui";

type Account = {
  id: string;
  instagram_user_id: string;
  username: string;
  display_name: string | null;
  profile_picture_url: string | null;
  account_type: string | null;
  status: string;
  token_expires_at: Date | null;
  token_last_refreshed_at: Date | null;
  token_last_checked_at: Date | null;
  last_successful_api_call_at: Date | null;
  last_error_at: Date | null;
  last_error_code: string | null;
  last_error_message: string | null;
  publishing_limit_usage: number | null;
  publishing_limit_total: number | null;
  publishing_limit_checked_at: Date | null;
  created_at: Date;
};

type GroupRow = { id: string; name: string };
type Stats = { published: number; pending: number; failed: number };
type Job = {
  id: string;
  campaign_id: string;
  campaign_name: string;
  status: string;
  scheduled_at: Date;
  published_at: Date | null;
  last_error_message: string | null;
};

type PageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ erro?: string | string[]; ok?: string | string[] }>;
};

function first(value?: string | string[]) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function AccountDetailPage({ params, searchParams }: PageProps) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const sql = getSqlClient();
  const [[account], groups, [stats], jobs] = await Promise.all([
    sql<Account[]>`
      SELECT id, instagram_user_id, username, display_name, profile_picture_url, account_type, status,
        token_expires_at, token_last_refreshed_at, token_last_checked_at,
        last_successful_api_call_at, last_error_at, last_error_code, last_error_message,
        publishing_limit_usage, publishing_limit_total, publishing_limit_checked_at, created_at
      FROM instagram_accounts WHERE id = ${id} LIMIT 1
    `,
    sql<GroupRow[]>`
      SELECT group_row.id, group_row.name
      FROM account_groups group_row
      JOIN account_group_members member ON member.group_id = group_row.id
      WHERE member.instagram_account_id = ${id}
      ORDER BY group_row.name
    `,
    sql<Stats[]>`
      SELECT
        count(*) FILTER (WHERE status = 'PUBLISHED')::int AS published,
        count(*) FILTER (WHERE status IN ('QUEUED', 'CLAIMED', 'CREATING_CONTAINER', 'WAITING_FOR_CONTAINER', 'READY_TO_PUBLISH', 'PUBLISHING', 'RETRY_WAIT'))::int AS pending,
        count(*) FILTER (WHERE status IN ('FAILED', 'RECONCILIATION_REQUIRED'))::int AS failed
      FROM publication_jobs WHERE instagram_account_id = ${id}
    `,
    sql<Job[]>`
      SELECT job.id, job.campaign_id, campaign.name AS campaign_name, job.status,
        job.scheduled_at, job.published_at, job.last_error_message
      FROM publication_jobs job
      JOIN campaigns campaign ON campaign.id = job.campaign_id
      WHERE job.instagram_account_id = ${id}
      ORDER BY job.updated_at DESC
      LIMIT 12
    `,
  ]);
  if (!account) notFound();

  const mustReconnect = ["REAUTH_REQUIRED", "DISCONNECTED", "DISABLED"].includes(account.status);
  const canVerify = !mustReconnect;
  const totalLimit = account.publishing_limit_total ?? 0;
  const limitUsage = account.publishing_limit_usage ?? 0;
  const remaining = Math.max(0, totalLimit - limitUsage);

  return (
    <div className="page-stack">
      <nav className="breadcrumbs" aria-label="Navegação estrutural">
        <Link href="/contas">Contas</Link><span aria-hidden="true">/</span><span>@{account.username}</span>
      </nav>
      <PageHeader
        eyebrow="Detalhes da conta"
        title={account.display_name ?? `@${account.username}`}
        description={`@${account.username}${account.account_type ? ` · ${account.account_type}` : ""}`}
        actions={
          <>
            {mustReconnect ? (
              <Link className="button button-primary" href="/api/instagram/oauth/start">Reconectar via Meta</Link>
            ) : (
              <form action={verifyAccountAction}>
                <input type="hidden" name="accountId" value={account.id} />
                <button className="button button-secondary" type="submit">Verificar agora</button>
              </form>
            )}
            {canVerify ? (
              <form action={disconnectAccountAction}>
                <input type="hidden" name="accountId" value={account.id} />
                <button className="button button-quiet-danger" type="submit">Desconectar</button>
              </form>
            ) : null}
          </>
        }
      />
      <MessageBanner error={first(query.erro)} success={first(query.ok)} />

      <section className="account-hero panel">
        <span className="account-avatar account-avatar-large" aria-hidden="true">
          {account.profile_picture_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={account.profile_picture_url} alt="" referrerPolicy="no-referrer" />
          ) : initials(account.display_name ?? account.username)}
        </span>
        <div className="account-hero-main">
          <StatusBadge status={account.status} />
          <p>Conta vinculada desde {formatDate(account.created_at, { dateOnly: true })}</p>
        </div>
        <DefinitionList
          items={[
            { label: "ID do Instagram", value: <span className="mono-copy">{account.instagram_user_id}</span> },
            { label: "Última verificação", value: formatDate(account.token_last_checked_at) },
            { label: "Última chamada bem-sucedida", value: formatDate(account.last_successful_api_call_at) },
          ]}
        />
      </section>

      {account.last_error_message ? (
        <div className="message-banner message-error" role="alert">
          <strong>{account.last_error_code ?? "Erro na conta"}</strong>
          <span>{account.last_error_message}</span>
          {account.last_error_at ? <small>Registrado em {formatDate(account.last_error_at)}</small> : null}
        </div>
      ) : null}

      <section className="metric-grid metric-grid-compact" aria-label="Resultados da conta">
        <MetricCard label="Publicadas" value={stats.published} tone="success" />
        <MetricCard label="Em processamento" value={stats.pending} tone="warning" />
        <MetricCard label="Com atenção" value={stats.failed} tone={stats.failed ? "danger" : "default"} />
        <MetricCard label="Cota disponível" value={totalLimit ? remaining : "—"} detail={totalLimit ? `${limitUsage} de ${totalLimit} usados` : "Ainda não consultada"} />
      </section>

      <section className="two-column-grid">
        <Panel title="Token e limite" description="Dados operacionais, sem expor credenciais">
          <DefinitionList
            items={[
              { label: "Validade do token", value: formatDate(account.token_expires_at) },
              { label: "Última renovação", value: formatDate(account.token_last_refreshed_at) },
              { label: "Limite consultado em", value: formatDate(account.publishing_limit_checked_at) },
              { label: "Uso informado pela Meta", value: totalLimit ? `${limitUsage} de ${totalLimit}` : "Não disponível" },
            ]}
          />
        </Panel>
        <Panel title="Grupos" description="Segmentações que incluem esta conta" action={<Link className="text-link" href="/grupos">Gerenciar</Link>}>
          {groups.length ? (
            <ul className="tag-list">{groups.map((group) => <li key={group.id}>{group.name}</li>)}</ul>
          ) : (
            <p className="panel-placeholder">Esta conta ainda não participa de nenhum grupo.</p>
          )}
        </Panel>
      </section>

      <Panel title="Atividade recente" description="Últimas publicações destinadas a esta conta">
        {jobs.length ? (
          <div className="table-scroll">
            <table>
              <thead><tr><th scope="col">Campanha</th><th scope="col">Status</th><th scope="col">Horário</th><th scope="col">Ocorrência</th></tr></thead>
              <tbody>
                {jobs.map((job) => (
                  <tr key={job.id}>
                    <td data-label="Campanha"><Link className="table-primary-link" href={`/campanhas/${job.campaign_id}`}>{job.campaign_name}</Link></td>
                    <td data-label="Status"><StatusBadge status={job.status} /></td>
                    <td data-label="Horário">{formatDate(job.published_at ?? job.scheduled_at)}</td>
                    <td data-label="Ocorrência" className="cell-wrap">{job.last_error_message ?? <span className="muted">—</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <EmptyState title="Sem atividade" description="Os jobs desta conta aparecerão aqui após o primeiro agendamento." />}
      </Panel>
    </div>
  );
}
