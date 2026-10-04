import { DateTime } from "luxon";
import Link from "next/link";
import { createScheduleAction, deleteScheduleAction, updateScheduleAction } from "@/app/actions";
import { AutoRefresh } from "@/components/auto-refresh";
import { CampaignMediaSelector } from "@/components/campaign-media-selector";
import { CampaignTargetsSelector } from "@/components/campaign-schedule-fields";
import { ConfirmSubmitButton } from "@/components/confirm-submit-button";
import { EmptyState, formatDate, MessageBanner, PageHeader, Panel, StatusBadge } from "@/components/ui";
import { getSqlClient } from "@/db/client";
import { getPrivateMediaUrl } from "@/providers/storage";
import { requireAdmin } from "@/server/auth";

type Account = { id: string; username: string; display_name: string | null; status: string };
type Group = { id: string; name: string; member_count: number; account_ids: string[] };
type Media = { id: string; original_filename: string; media_kind: "IMAGE" | "VIDEO"; size_bytes: number; folder_id: string | null; folder_name: string | null };
type ScheduleRow = {
  id: string;
  name: string;
  status: string;
  start_date: string;
  end_date: string;
  times: string[];
  days_of_week: number[];
  timezone: string;
  media_type: "REELS" | "IMAGE";
  default_caption: string;
  auto_comment_text: string;
  auto_comment_delay_minutes: number;
  account_count: number;
  media_count: number;
  jobs_total: number;
  jobs_published: number;
  next_publication_at: Date | null;
  account_ids: string[];
  media_ids: string[];
};
type PageProps = { searchParams: Promise<{ erro?: string | string[]; ok?: string | string[]; editar?: string | string[] }> };
function first(value?: string | string[]) { return Array.isArray(value) ? value[0] : value; }
function formatLocalDate(value: string) { return value.split("-").reverse().join("/"); }
const weekdays = [{ value: 0, label: "Dom" }, { value: 1, label: "Seg" }, { value: 2, label: "Ter" }, { value: 3, label: "Qua" }, { value: 4, label: "Qui" }, { value: 5, label: "Sex" }, { value: 6, label: "Sáb" }];

export default async function SchedulesPage({ searchParams }: PageProps) {
  const user = await requireAdmin();
  const query = await searchParams;
  const [accounts, groups, media, schedules, [settings]] = await Promise.all([
    getSqlClient()<Account[]>`SELECT id, username, display_name, status FROM instagram_accounts WHERE organization_id = ${user.organizationId} AND status IN ('CONNECTED', 'TOKEN_EXPIRING') ORDER BY username`,
    getSqlClient()<Group[]>`
      SELECT selected_group.id, selected_group.name, count(member.instagram_account_id)::int AS member_count,
        COALESCE(json_agg(member.instagram_account_id ORDER BY member.created_at) FILTER (WHERE member.instagram_account_id IS NOT NULL), '[]') AS account_ids
      FROM account_groups selected_group
      LEFT JOIN account_group_members member ON member.organization_id = selected_group.organization_id AND member.group_id = selected_group.id
      WHERE selected_group.organization_id = ${user.organizationId}
      GROUP BY selected_group.id ORDER BY selected_group.name
    `,
    getSqlClient()<Media[]>`
      SELECT asset.id, asset.original_filename, asset.media_kind, asset.size_bytes, asset.folder_id, folder.name AS folder_name
      FROM media_assets asset LEFT JOIN media_folders folder ON folder.organization_id = asset.organization_id AND folder.id = asset.folder_id
      WHERE asset.organization_id = ${user.organizationId} AND asset.processing_status = 'READY' AND asset.deleted_at IS NULL
      ORDER BY asset.created_at DESC
    `,
    getSqlClient()<ScheduleRow[]>`
      SELECT schedule.id, schedule.name, campaign.status, schedule.start_date::text, schedule.end_date::text,
        schedule.times, schedule.days_of_week, schedule.timezone, schedule.media_type, schedule.default_caption,
        schedule.auto_comment_text, schedule.auto_comment_delay_minutes,
        (SELECT count(*)::int FROM schedule_accounts selected_account WHERE selected_account.organization_id = schedule.organization_id AND selected_account.schedule_id = schedule.id) AS account_count,
        (SELECT count(*)::int FROM schedule_media selected_media WHERE selected_media.organization_id = schedule.organization_id AND selected_media.schedule_id = schedule.id) AS media_count,
        (SELECT count(*)::int FROM publication_jobs job WHERE job.organization_id = schedule.organization_id AND job.schedule_id = schedule.id) AS jobs_total,
        (SELECT count(*)::int FROM publication_jobs job WHERE job.organization_id = schedule.organization_id AND job.schedule_id = schedule.id AND job.status = 'PUBLISHED') AS jobs_published,
        (SELECT min(job.scheduled_at) FROM publication_jobs job WHERE job.organization_id = schedule.organization_id AND job.schedule_id = schedule.id AND job.status IN ('QUEUED', 'RETRY_WAIT')) AS next_publication_at,
        ARRAY(SELECT selected_account.instagram_account_id::text FROM schedule_accounts selected_account
          WHERE selected_account.organization_id = schedule.organization_id AND selected_account.schedule_id = schedule.id) AS account_ids,
        ARRAY(SELECT selected_media.media_asset_id::text FROM schedule_media selected_media
          WHERE selected_media.organization_id = schedule.organization_id AND selected_media.schedule_id = schedule.id
          ORDER BY selected_media.position) AS media_ids
      FROM schedules schedule
      JOIN campaigns campaign ON campaign.organization_id = schedule.organization_id AND campaign.id = schedule.campaign_id
      WHERE schedule.organization_id = ${user.organizationId}
      ORDER BY schedule.created_at DESC
    `,
    getSqlClient()<Array<{ default_timezone: string }>>`SELECT default_timezone FROM settings WHERE organization_id = ${user.organizationId}`,
  ]);
  const timezone = settings?.default_timezone ?? "America/Sao_Paulo";
  const localToday = DateTime.now().setZone(timezone);
  const today = localToday.toISODate()!;
  const nextWeek = localToday.plus({ days: 7 }).toISODate()!;
  const mediaWithUrls = media.map((asset) => ({ ...asset, previewUrl: getPrivateMediaUrl(asset.id, user.organizationId) }));
  const canCreate = accounts.length > 0 && media.length > 0;
  const editing = schedules.find((schedule) => schedule.id === first(query.editar));

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Automação"
        title="Escalas recorrentes"
        description="Cruze um período, dias da semana e horários. Cada mídia ocupa um horário e é publicada em todas as contas escolhidas."
        actions={canCreate ? <a className="button button-primary" href="#nova-escala">Nova escala</a> : undefined}
      />
      <AutoRefresh intervalMs={15_000} />
      <MessageBanner error={first(query.erro)} success={first(query.ok)} />

      <Panel title="Escalas configuradas">
        {schedules.length ? (
          <div className="table-scroll"><table>
            <thead><tr><th>Escala</th><th>Status</th><th>Período</th><th>Horários</th><th>Contas</th><th>Progresso</th><th>Próximo</th><th>Ação</th></tr></thead>
            <tbody>{schedules.map((schedule) => (
              <tr key={schedule.id}>
                <td data-label="Escala"><strong>{schedule.name}</strong><small>{schedule.media_count} mídia(s)</small></td>
                <td data-label="Status"><StatusBadge status={schedule.status} /></td>
                <td data-label="Período">{formatLocalDate(schedule.start_date)} – {formatLocalDate(schedule.end_date)}</td>
                <td data-label="Horários">{schedule.times.join(", ")}<small>{weekdays.filter((day) => schedule.days_of_week.includes(day.value)).map((day) => day.label).join(", ")}</small></td>
                <td data-label="Contas">{schedule.account_count}</td>
                <td data-label="Progresso">{schedule.jobs_published} de {schedule.jobs_total}</td>
                <td data-label="Próximo">{schedule.next_publication_at ? formatDate(schedule.next_publication_at, { timezone: schedule.timezone }) : <span className="muted">—</span>}</td>
                <td data-label="Ação"><div className="table-actions"><Link className="button button-small button-secondary" href={`/escalas?editar=${schedule.id}#nova-escala`}>Editar</Link><form action={deleteScheduleAction}><input name="scheduleId" type="hidden" value={schedule.id} /><ConfirmSubmitButton className="button button-small button-ghost" message="Remover a escala e cancelar publicações pendentes?">Excluir</ConfirmSubmitButton></form></div></td>
              </tr>
            ))}</tbody>
          </table></div>
        ) : <EmptyState title="Nenhuma escala criada" description="Distribua uma sequência de mídias em dias e horários recorrentes." />}
      </Panel>

      <Panel
        title={editing ? `Editando: ${editing.name}` : "Nova escala"}
        description={editing ? "Publicações concluídas são preservadas; as pendentes são redistribuídas nos novos horários." : "Se houver mais mídias que horários, as excedentes ficam fora desta escala; se houver menos, os horários restantes ficam livres."}
        action={editing ? <Link className="button button-small button-secondary" href="/escalas">Cancelar edição</Link> : undefined}
      >
        <div id="nova-escala" />
        {canCreate ? (
          <form key={editing?.id ?? "new"} className="form-stack" action={editing ? updateScheduleAction : createScheduleAction}>
            {editing ? <input name="scheduleId" type="hidden" value={editing.id} /> : null}
            <div className="form-grid form-grid-four">
              <label className="field-span-two">Nome<input name="name" maxLength={160} placeholder="Ex.: Conteúdo de outubro" defaultValue={editing?.name} required /></label>
              <label>Data inicial<input name="startDate" type="date" min={editing ? undefined : today} defaultValue={editing?.start_date ?? today} required /></label>
              <label>Data final<input name="endDate" type="date" min={editing ? undefined : today} defaultValue={editing?.end_date ?? nextWeek} required /></label>
              <label className="field-span-two">Horários <span className="optional-label">separados por vírgula</span><input name="times" placeholder="09:00, 14:30, 19:00" defaultValue={editing?.times.join(", ")} required /></label>
              <label>Fuso horário<select name="timezone" defaultValue={editing?.timezone ?? timezone}><option value="America/Sao_Paulo">America/Sao_Paulo</option><option value="America/Manaus">America/Manaus</option><option value="America/Recife">America/Recife</option><option value="America/Fortaleza">America/Fortaleza</option><option value="America/Rio_Branco">America/Rio_Branco</option></select></label>
              <label>Tipo de mídia<select name="mediaType" defaultValue={editing?.media_type ?? "REELS"}><option value="REELS">Reels</option><option value="IMAGE">Imagens</option></select></label>
            </div>
            <fieldset className="choice-grid"><legend>Dias da semana</legend>{weekdays.map((day) => <label className="choice-card" key={day.value}><input name="daysOfWeek" type="checkbox" value={day.value} defaultChecked={editing ? editing.days_of_week.includes(day.value) : true} /><span><strong>{day.label}</strong></span></label>)}</fieldset>
            <label>Legenda padrão<textarea name="defaultCaption" rows={4} maxLength={2200} placeholder="Opcional" defaultValue={editing?.default_caption} /></label>
            <div className="form-grid form-grid-four">
              <label className="field-span-two">Auto-comentário<textarea name="autoCommentText" rows={3} maxLength={2200} placeholder="Ex.: Link na bio — deixe vazio para desativar" defaultValue={editing?.auto_comment_text} /></label>
              <label>Esperar após publicar (min)<input name="autoCommentDelayMinutes" type="number" min={0} max={10080} defaultValue={editing?.auto_comment_delay_minutes ?? 5} required /></label>
            </div>
            <fieldset className="form-section"><legend>Contas e grupos</legend><CampaignTargetsSelector key={editing?.id ?? "new"} accounts={accounts} groups={groups} initialAccountIds={editing?.account_ids ?? []} /></fieldset>
            <fieldset className="form-section"><legend>Mídias na ordem da escala</legend><CampaignMediaSelector key={editing?.id ?? "new"} media={mediaWithUrls} initialMediaIds={editing?.media_ids ?? []} /></fieldset>
            <button className="button button-primary" type="submit">{editing ? "Salvar e reagendar pendentes" : "Criar escala"}</button>
          </form>
        ) : <EmptyState title="Faltam contas ou mídias prontas" description="Conecte uma conta e envie mídia válida antes de criar a escala." href={accounts.length ? "/midias" : "/contas"} actionLabel={accounts.length ? "Ir para mídias" : "Ir para contas"} />}
      </Panel>
    </div>
  );
}
