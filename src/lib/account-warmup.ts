export const WARMUP_PROFILES = {
  FAST: { label: "Rápido", steps: [[1, 2], [2, 6], [3, 12]] },
  BALANCED: { label: "Balanceado", steps: [[2, 2], [4, 4], [6, 8], [8, 12], [10, 16]] },
  CONSERVATIVE: { label: "Conservador", steps: [[4, 2], [8, 4], [12, 8], [16, 12], [20, 16]] },
} as const;

export type WarmupProfile = keyof typeof WARMUP_PROFILES;
export const DAY_MS = 24 * 60 * 60 * 1000;

export function accountWarmup(profile: WarmupProfile | null | undefined, connectedAt: Date | string, now = new Date()) {
  if (!profile) return null;
  const config = WARMUP_PROFILES[profile];
  const elapsed = Math.max(0, now.getTime() - new Date(connectedAt).getTime());
  const day = Math.floor(elapsed / DAY_MS) + 1;
  const step = config.steps.find(([end]) => elapsed < end * DAY_MS);
  const durationDays = config.steps[config.steps.length - 1][0];
  return { profile, label: config.label, day, durationDays, dailyLimit: step?.[1] ?? null,
    active: Boolean(step), endsAt: new Date(new Date(connectedAt).getTime() + durationDays * DAY_MS),
    stageEndsAt: step ? new Date(new Date(connectedAt).getTime() + step[0] * DAY_MS) : null };
}

export function warmupPublicationAt(input: {
  now: Date; dailyLimit: number; publishedAt: Array<Date | string>; lastAttemptAt?: Date | string | null;
}) {
  const published = input.publishedAt.map((date) => new Date(date).getTime()).sort((a, b) => b - a);
  const recent = published.filter((date) => date > input.now.getTime() - DAY_MS);
  const lastActivity = Math.max(published[0] ?? 0, input.lastAttemptAt ? new Date(input.lastAttemptAt).getTime() : 0);
  const spacing = lastActivity ? lastActivity + DAY_MS / input.dailyLimit : 0;
  const quota = recent.length >= input.dailyLimit ? recent[input.dailyLimit - 1] + DAY_MS : 0;
  return new Date(Math.max(input.now.getTime(), spacing, quota));
}
