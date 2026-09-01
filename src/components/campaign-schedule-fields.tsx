"use client";

import { useMemo, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { StatusBadge, initials } from "@/components/ui";

type AccountOption = { id: string; username: string; display_name: string | null; status: string };
type GroupOption = { id: string; name: string; member_count: number; account_ids: string[] };

export function CampaignTargetsSelector({
  accounts,
  groups,
  initialAccountIds,
}: {
  accounts: AccountOption[];
  groups: GroupOption[];
  initialAccountIds: string[];
}) {
  const [all, setAll] = useState(false);
  const [selectedAccounts, setSelectedAccounts] = useState(() => new Set(initialAccountIds));
  const [selectedGroups, setSelectedGroups] = useState(() => new Set<string>());
  const availableIds = useMemo(() => new Set(accounts.map((account) => account.id)), [accounts]);
  const selectedCount = useMemo(() => {
    if (all) return accounts.length;
    const ids = new Set([...selectedAccounts].filter((id) => availableIds.has(id)));
    for (const group of groups) {
      if (!selectedGroups.has(group.id)) continue;
      for (const accountId of group.account_ids) if (availableIds.has(accountId)) ids.add(accountId);
    }
    return ids.size;
  }, [accounts.length, all, availableIds, groups, selectedAccounts, selectedGroups]);

  function toggle(setter: Dispatch<SetStateAction<Set<string>>>, value: string, checked: boolean) {
    setter((current) => {
      const next = new Set(current);
      if (checked) next.add(value);
      else next.delete(value);
      return next;
    });
  }

  return (
    <>
      {[...selectedAccounts].map((accountId) => <input key={accountId} name="accountIds" type="hidden" value={accountId} />)}
      {[...selectedGroups].map((groupId) => <input key={groupId} name="groupIds" type="hidden" value={groupId} />)}
      <div className="target-selection-summary" role="status" aria-live="polite">
        <strong>{selectedCount}</strong>
        <span>{selectedCount === 1 ? "conta selecionada" : "contas selecionadas"}</span>
      </div>
      <label className="select-all-row">
        <input name="allAccounts" type="checkbox" checked={all} onChange={(event) => setAll(event.currentTarget.checked)} />
        <span><strong>Todas as contas disponíveis</strong><small>{accounts.length} contas conectadas ou com token próximo do vencimento</small></span>
      </label>
      {groups.length ? (
        <fieldset className="choice-grid">
          <legend>Grupos</legend>
          {groups.map((group) => (
            <label className="choice-card" key={group.id}>
              <input
                type="checkbox"
                value={group.id}
                checked={selectedGroups.has(group.id)}
                onChange={(event) => toggle(setSelectedGroups, group.id, event.currentTarget.checked)}
              />
              <span><strong>{group.name}</strong><small>{group.member_count} {group.member_count === 1 ? "conta" : "contas"}</small></span>
            </label>
          ))}
        </fieldset>
      ) : null}
      <details className="native-disclosure account-selector" open={initialAccountIds.length > 0}>
        <summary>Selecionar contas individualmente</summary>
        <fieldset className="checkbox-list checkbox-list-columns">
          <legend className="sr-only">Contas individuais</legend>
          {accounts.map((account) => (
            <label className="checkbox-row" key={account.id}>
              <input
                type="checkbox"
                value={account.id}
                checked={selectedAccounts.has(account.id)}
                onChange={(event) => toggle(setSelectedAccounts, account.id, event.currentTarget.checked)}
              />
              <span className="account-avatar account-avatar-small" aria-hidden="true">{initials(account.display_name ?? account.username)}</span>
              <span className="checkbox-row-copy"><strong>{account.display_name ?? `@${account.username}`}</strong><small>@{account.username}</small></span>
              <StatusBadge status={account.status} />
            </label>
          ))}
        </fieldset>
      </details>
    </>
  );
}

type RhythmMode = "NONE" | "FIXED" | "RANDOM";

export function CampaignRhythmFields({
  startAt,
  timezone,
  delayMode,
  delayFixedSeconds,
  delayMinSeconds,
  delayMaxSeconds,
  targetOrder,
}: {
  startAt: string;
  timezone: string;
  delayMode: "FIXED" | "RANDOM";
  delayFixedSeconds: number;
  delayMinSeconds: number;
  delayMaxSeconds: number;
  targetOrder: "SELECTED" | "RANDOM" | "USERNAME";
}) {
  const initialMode: RhythmMode = delayMode === "RANDOM" ? "RANDOM" : delayFixedSeconds === 0 ? "NONE" : "FIXED";
  const [mode, setMode] = useState<RhythmMode>(initialMode);

  return (
    <div className="form-grid form-grid-four">
      <label>Início<input name="startAt" type="datetime-local" defaultValue={startAt} required /></label>
      <label>
        Fuso horário
        <select name="timezone" defaultValue={timezone}>
          <option value="America/Sao_Paulo">America/Sao_Paulo</option>
          <option value="America/Manaus">America/Manaus</option>
          <option value="America/Recife">America/Recife</option>
          <option value="America/Fortaleza">America/Fortaleza</option>
          <option value="America/Rio_Branco">America/Rio_Branco</option>
        </select>
      </label>
      <label>
        Tipo de intervalo
        <select value={mode} onChange={(event) => setMode(event.currentTarget.value as RhythmMode)}>
          <option value="NONE">Sem intervalo</option>
          <option value="FIXED">Fixo</option>
          <option value="RANDOM">Aleatório</option>
        </select>
        <input type="hidden" name="delayMode" value={mode === "RANDOM" ? "RANDOM" : "FIXED"} />
      </label>
      <label>
        Ordem das contas
        <select name="targetOrder" defaultValue={targetOrder}>
          <option value="SELECTED">Ordem da seleção</option>
          <option value="USERNAME">Nome de usuário</option>
          <option value="RANDOM">Aleatória</option>
        </select>
      </label>
      {mode === "NONE" ? <input type="hidden" name="delayFixedSeconds" value="0" /> : null}
      {mode === "FIXED" ? (
        <label>Intervalo fixo (segundos)<input name="delayFixedSeconds" type="number" min="0" max="86400" defaultValue={delayFixedSeconds} required /></label>
      ) : null}
      {mode === "RANDOM" ? (
        <>
          <label>Intervalo mínimo (segundos)<input name="delayMinSeconds" type="number" min="0" max="86400" defaultValue={delayMinSeconds} required /></label>
          <label>Intervalo máximo (segundos)<input name="delayMaxSeconds" type="number" min="0" max="86400" defaultValue={delayMaxSeconds} required /></label>
        </>
      ) : null}
    </div>
  );
}
