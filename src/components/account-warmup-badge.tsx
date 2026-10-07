import { WARMUP_PROFILES, type WarmupProfile } from "@/lib/account-warmup";

export function AccountWarmupBadge({ profile }: { profile: WarmupProfile | null }) {
  if (!profile) return null;
  return <span className="new-account-badge account-warmup-badge">{WARMUP_PROFILES[profile].label}</span>;
}
