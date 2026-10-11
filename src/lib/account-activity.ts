import { DAY_MS } from "./account-warmup";

type Timestamp = Date | string | null;

export type AccountActivityDates = {
  status: string;
  created_at: Timestamp;
  authorized_at: Timestamp;
  active_started_at: Timestamp;
  active_ended_at: Timestamp;
  active_timing_estimated: boolean;
  disconnected_at: Timestamp;
  banned_at: Timestamp;
  instagram_user_id: string;
  activity_observed_at?: Timestamp;
};

export function accountActivity(account: AccountActivityDates, now = account.activity_observed_at ? new Date(account.activity_observed_at) : new Date()) {
  const date = (value: Timestamp) => {
    if (!value) return null;
    const parsed = new Date(value);
    return Number.isFinite(parsed.getTime()) ? parsed : null;
  };
  const deleted = account.instagram_user_id.startsWith("deleted_");
  const active = !deleted && ["CONNECTED", "TOKEN_EXPIRING"].includes(account.status);
  const startedAt = deleted ? null : account.active_started_at ? date(account.active_started_at)
    : date(account.authorized_at) ?? date(account.created_at);
  const legacyEnds = [date(account.disconnected_at), date(account.banned_at)]
    .filter((value): value is Date => value !== null)
    .sort((a, b) => a.getTime() - b.getTime());
  const endedAt = deleted ? null : account.active_ended_at ? date(account.active_ended_at)
    : active ? null : legacyEnds[0] ?? null;
  const end = endedAt ?? (active ? now : null);
  const days = startedAt && end && (!account.active_ended_at || endedAt)
    && startedAt.getTime() <= end.getTime() && end.getTime() <= now.getTime()
    ? Math.floor((end.getTime() - startedAt.getTime()) / DAY_MS) : null;
  const estimated = account.active_timing_estimated || !account.active_started_at || (!active && !account.active_ended_at);
  return { active, startedAt, endedAt, days, estimated };
}

export function activityDuration(days: number | null) {
  return days === null ? "Tempo ativo indisponível" : days === 0 ? "Menos de 1 dia" : `${days} ${days === 1 ? "dia" : "dias"}`;
}
