import Link from "next/link";

const statusLabels: Record<string, string> = {
  CONNECTED: "Conectada",
  TOKEN_EXPIRING: "Token expirando",
  REAUTH_REQUIRED: "Reconexão necessária",
  DISCONNECTED: "Desconectada",
  ERROR: "Com erro",
  DISABLED: "Desativada",
  UPLOADING: "Enviando",
  READY: "Pronta",
  INVALID: "Inválida",
  DELETED: "Excluída",
  DRAFT: "Rascunho",
  SCHEDULED: "Agendada",
  RUNNING: "Em execução",
  PAUSED: "Pausada",
  COMPLETED: "Concluída",
  PARTIALLY_FAILED: "Falha parcial",
  FAILED: "Falhou",
  CANCELLED: "Cancelada",
  QUEUED: "Na fila",
  CLAIMED: "Reservado",
  CREATING_CONTAINER: "Criando publicação",
  WAITING_FOR_CONTAINER: "Processando na Meta",
  READY_TO_PUBLISH: "Pronto para publicar",
  PUBLISHING: "Publicando",
  PUBLISHED: "Publicado",
  RETRY_WAIT: "Aguardando nova tentativa",
  RECONCILIATION_REQUIRED: "Verificação manual",
  ONLINE: "Online",
  OFFLINE: "Offline",
  BANNED: "Banida",
};

const successStatuses = new Set(["CONNECTED", "READY", "COMPLETED", "PUBLISHED", "ONLINE"]);
const warningStatuses = new Set([
  "TOKEN_EXPIRING",
  "UPLOADING",
  "SCHEDULED",
  "QUEUED",
  "CLAIMED",
  "CREATING_CONTAINER",
  "WAITING_FOR_CONTAINER",
  "READY_TO_PUBLISH",
  "PUBLISHING",
  "RETRY_WAIT",
  "RUNNING",
]);
const dangerStatuses = new Set([
  "REAUTH_REQUIRED",
  "ERROR",
  "INVALID",
  "FAILED",
  "PARTIALLY_FAILED",
  "RECONCILIATION_REQUIRED",
  "OFFLINE",
  "BANNED",
]);

export function StatusBadge({ status, label }: { status: string; label?: string }) {
  const tone = successStatuses.has(status)
    ? "success"
    : warningStatuses.has(status)
      ? "warning"
      : dangerStatuses.has(status)
        ? "danger"
        : "neutral";
  return (
    <span className={`status-badge status-${tone}`}>
      <span className="status-dot" aria-hidden="true" />
      {label ?? statusLabels[status] ?? status.replaceAll("_", " ")}
    </span>
  );
}

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: React.ReactNode;
}) {
  return (
    <header className="page-header">
      <div>
        {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
        <h1>{title}</h1>
        {description ? <p className="page-description">{description}</p> : null}
      </div>
      {actions ? <div className="page-actions">{actions}</div> : null}
    </header>
  );
}

export function MetricCard({
  label,
  value,
  detail,
  tone = "default",
}: {
  label: string;
  value: string | number;
  detail?: React.ReactNode;
  tone?: "default" | "brand" | "success" | "warning" | "danger";
}) {
  return (
    <article className={`metric-card metric-${tone}`}>
      <span className="metric-label">{label}</span>
      <strong className="metric-value">{value}</strong>
      {detail ? <span className="metric-detail">{detail}</span> : null}
    </article>
  );
}

export function Panel({
  title,
  description,
  action,
  children,
  className = "",
}: {
  title?: string;
  description?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`panel ${className}`.trim()}>
      {title || description || action ? (
        <header className="panel-header">
          <div>
            {title ? <h2>{title}</h2> : null}
            {description ? <p>{description}</p> : null}
          </div>
          {action ? <div className="panel-action">{action}</div> : null}
        </header>
      ) : null}
      {children}
    </section>
  );
}

export function EmptyState({
  title,
  description,
  href,
  actionLabel,
}: {
  title: string;
  description: string;
  href?: string;
  actionLabel?: string;
}) {
  return (
    <div className="empty-state">
      <span className="empty-state-mark" aria-hidden="true">
        ·
      </span>
      <h3>{title}</h3>
      <p>{description}</p>
      {href && actionLabel ? (
        <Link className="button button-secondary" href={href}>
          {actionLabel}
        </Link>
      ) : null}
    </div>
  );
}

export function MessageBanner({ error, success }: { error?: string; success?: string }) {
  if (!error && !success) return null;
  return (
    <div className={`message-banner ${error ? "message-error" : "message-success"}`} role={error ? "alert" : "status"}>
      <strong>{error ? "Não foi possível concluir" : "Tudo certo"}</strong>
      <span>{error ?? success}</span>
    </div>
  );
}

export function DefinitionList({
  items,
}: {
  items: Array<{ label: string; value: React.ReactNode }>;
}) {
  return (
    <dl className="definition-list">
      {items.map((item) => (
        <div key={item.label}>
          <dt>{item.label}</dt>
          <dd>{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function formatDate(
  value: Date | string | null | undefined,
  options?: { dateOnly?: boolean; timezone?: string },
) {
  if (!value) return "—";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    ...(options?.dateOnly ? {} : { timeStyle: "short" }),
    timeZone: options?.timezone ?? "America/Sao_Paulo",
  }).format(date);
}

export function formatBytes(bytes: number | string | bigint) {
  const numericBytes = Number(bytes);
  if (!Number.isFinite(numericBytes) || numericBytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const unit = Math.min(Math.floor(Math.log(numericBytes) / Math.log(1024)), units.length - 1);
  const value = numericBytes / 1024 ** unit;
  return `${new Intl.NumberFormat("pt-BR", { maximumFractionDigits: unit === 0 ? 0 : 1 }).format(value)} ${units[unit]}`;
}

export function formatPublicationType(value: string) {
  return (
    {
      FEED_IMAGE: "Imagem no Feed",
      FEED_VIDEO: "Vídeo no Feed",
      REEL: "Reel",
      STORY_IMAGE: "Story com imagem",
      STORY_VIDEO: "Story com vídeo",
      CAROUSEL: "Carrossel",
    }[value] ?? value
  );
}

export function initials(value: string) {
  return value
    .split(/[\s._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

export function formatNumber(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("pt-BR").format(value);
}

export function Delta({ value }: { value: number | null }) {
  if (value === null) return <span className="metric-delta metric-delta-neutral">novo</span>;
  const tone = value > 0 ? "up" : value < 0 ? "down" : "neutral";
  const arrow = value > 0 ? "▲" : value < 0 ? "▼" : "•";
  return (
    <span className={`metric-delta metric-delta-${tone}`}>
      {arrow} {new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 }).format(Math.abs(value))}% vs. período anterior
    </span>
  );
}
