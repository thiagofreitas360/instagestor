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
  const [groupFilter, setGroupFilter] = useState("");
  const [search, setSearch] = useState("");
  const availableIds = useMemo(() => new Set(accounts.map((account) => account.id)), [accounts]);
  const filteredAccounts = useMemo(() => {
    const memberIds = groups.find((group) => group.id === groupFilter)?.account_ids;
    const term = search.trim().toLocaleLowerCase("pt-BR");
    return accounts.filter((account) => (
      (!memberIds || memberIds.includes(account.id))
      && (!term || account.username.toLocaleLowerCase("pt-BR").includes(term)
        || account.display_name?.toLocaleLowerCase("pt-BR").includes(term))
    ));
  }, [accounts, groupFilter, groups, search]);
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

  function selectFilteredAccounts() {
    setSelectedAccounts((current) => new Set([...current, ...filteredAccounts.map((account) => account.id)]));
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
          <legend>Nichos / grupos</legend>
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
        <div className="page-actions">
          <label>
            Filtrar por nicho
            <select value={groupFilter} onChange={(event) => setGroupFilter(event.currentTarget.value)}>
              <option value="">Todos os nichos</option>
              {groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}
            </select>
          </label>
          <label>
            Buscar conta
            <input type="search" value={search} onChange={(event) => setSearch(event.currentTarget.value)} placeholder="@usuario" />
          </label>
          <button className="button button-small button-secondary" type="button" onClick={selectFilteredAccounts} disabled={!filteredAccounts.length}>
            Selecionar contas visíveis
          </button>
        </div>
        <fieldset className="checkbox-list checkbox-list-columns">
          <legend className="sr-only">Contas individuais</legend>
          {filteredAccounts.map((account) => (
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
          <option value="RANDOM">Aleatório inteligente (25–60 min)</option>
          <option value="FIXED">Fixo</option>
          <option value="NONE">Sem intervalo</option>
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
      {mode === "NONE" ? <input type="hidden" name="delayFixedMinutes" value="0" /> : null}
      {mode === "FIXED" ? (
        <label>Intervalo fixo (minutos)<input name="delayFixedMinutes" type="number" min="1" max="1440" defaultValue={Math.max(1, Math.round(delayFixedSeconds / 60))} required /></label>
      ) : null}
      {mode === "RANDOM" ? (
        <>
          <label>Intervalo mínimo (minutos)<input name="delayMinMinutes" type="number" min="25" max="60" defaultValue={Math.max(25, Math.round(delayMinSeconds / 60))} required /></label>
          <label>Intervalo máximo (minutos)<input name="delayMaxMinutes" type="number" min="25" max="60" defaultValue={Math.min(60, Math.max(25, Math.round(delayMaxSeconds / 60)))} required /></label>
        </>
      ) : null}
    </div>
  );
}
