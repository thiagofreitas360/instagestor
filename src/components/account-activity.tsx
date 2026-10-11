import { accountActivity, activityDuration, type AccountActivityDates } from "@/lib/account-activity";
import { formatDate } from "./ui";

export function AccountActivity({ account }: { account: AccountActivityDates }) {
  const activity = accountActivity(account);
  return (
    <div className="account-activity">
      <strong>Conectada em {formatDate(activity.startedAt, { dateOnly: true })}</strong>
      <small>{activity.days === null ? activityDuration(null)
        : `${activity.active ? "Ativa há" : "Ficou ativa"} ${activityDuration(activity.days).toLocaleLowerCase("pt-BR")}`}
        {activity.days !== null && activity.estimated ? " (estimado)" : ""}</small>
      {activity.endedAt ? <small>Atividade encerrada em {formatDate(activity.endedAt)}</small> : null}
      {account.status === "BANNED" && account.banned_at ? <small>Banida em {formatDate(account.banned_at)}</small> : null}
    </div>
  );
}
