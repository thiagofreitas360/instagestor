import { DateTime } from "luxon";
import { DAY_MS } from "./account-warmup";

export const ACTIVITY_PERIODS = { hoje: "Hoje", ontem: "Ontem", "7d": "7 dias", "30d": "30 dias" } as const;
export type ActivityPeriod = keyof typeof ACTIVITY_PERIODS;

/** Intervalo [from, to) no fuso da organização; "7d" e "30d" incluem o dia de hoje, como em Análises. */
export function activityPeriodRange(period: ActivityPeriod, timezone: string, now = new Date()) {
  const today = DateTime.fromJSDate(now).setZone(timezone).startOf("day");
  const days = period === "7d" ? 7 : period === "30d" ? 30 : 1;
  const from = period === "ontem" ? today.minus({ days: 1 }) : today.minus({ days: days - 1 });
  const to = period === "ontem" ? today : today.plus({ days: 1 });
  return { from: from.toJSDate(), to: to.toJSDate() };
}

export type DateRange = { from?: Date; to?: Date };

/** Intervalo [de 00:00, até 24:00) no fuso da organização; cada extremo é opcional e datas inválidas são ignoradas. */
export function customPeriodRange(from: string | undefined, to: string | undefined, timezone: string): DateRange | undefined {
  const day = (value?: string) => {
    const parsed = value ? DateTime.fromISO(value, { zone: timezone }) : undefined;
    return parsed?.isValid ? parsed.startOf("day") : undefined;
  };
  const start = day(from);
  const end = day(to);
  if (!start && !end) return undefined;
  return { from: start?.toJSDate(), to: end?.plus({ days: 1 }).toJSDate() };
}

export function inDateRange(date: Date | null, range: DateRange | undefined) {
  if (!range) return true;
  return Boolean(date && (!range.from || date >= range.from) && (!range.to || date < range.to));
}

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
