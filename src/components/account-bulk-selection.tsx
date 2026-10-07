"use client";

import { useActionState, useRef, useState } from "react";
import { setAccountsNewStatusAction } from "@/app/actions";
import { WARMUP_PROFILES, type WarmupProfile } from "@/lib/account-warmup";

async function saveStatus(_previous: null, formData: FormData) {
  await setAccountsNewStatusAction(formData);
  return null;
}

export function AccountBulkSelection({ children, returnTo, total }: {
  children: React.ReactNode; returnTo: string; total: number;
}) {
  const root = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState(0);
  const [, action, pending] = useActionState(saveStatus, null);

  function updateSelection(checked?: boolean) {
    const inputs = Array.from(root.current?.querySelectorAll<HTMLInputElement>('input[name="accountIds"]') ?? []);
    if (checked !== undefined) inputs.forEach((input) => { input.checked = checked; });
    const count = inputs.filter((input) => input.checked).length;
    const all = root.current?.querySelector<HTMLInputElement>('input[data-select-all]');
    if (all) {
      all.checked = count === total && total > 0;
      all.indeterminate = count > 0 && count < total;
    }
    setSelected(count);
  }

  return (
    <div ref={root} onChange={(event) => {
      const input = event.target;
      if (input instanceof HTMLInputElement && input.type === "checkbox") {
        updateSelection(input.hasAttribute("data-select-all") ? input.checked : undefined);
      }
    }}>
      <form id="account-classification-form" action={action} onReset={() => updateSelection(false)} className="account-bulk-toolbar">
        <input type="hidden" name="returnTo" value={returnTo} />
        <button className="button button-small button-secondary" type="button" disabled={pending} onClick={() => updateSelection(true)}>
          Selecionar todas as {total} contas deste filtro
        </button>
        <span role="status" aria-live="polite">{pending ? "Salvando classificação…" : `${selected} ${selected === 1 ? "conta selecionada" : "contas selecionadas"}`}</span>
        {selected > 0 ? <>
          <label>Perfil de aquecimento
            <select name="warmupProfile" defaultValue="BALANCED" disabled={pending}>
              {Object.entries(WARMUP_PROFILES).map(([value, profile]) => <option key={value} value={value}>{profile.label}</option>)}
              <option value="OFF">Desativado · ritmo normal</option>
            </select>
          </label>
          <button className="button button-small button-primary" disabled={pending}>Aplicar perfil</button>
          <button className="button button-small button-ghost" type="button" disabled={pending} onClick={() => updateSelection(false)}>Limpar seleção</button>
        </> : null}
      </form>
      <fieldset className="account-selection-fields" disabled={pending}>
        <legend className="sr-only">Selecionar contas para alterar a classificação</legend>
        {children}
      </fieldset>
    </div>
  );
}

export function AccountWarmupForm({ accountId, profile }: { accountId: string; profile: WarmupProfile | null }) {
  const [enabled, setEnabled] = useState(Boolean(profile));
  const [selected, setSelected] = useState<WarmupProfile>(profile ?? "BALANCED");
  const [, action, pending] = useActionState(saveStatus, null);
  const steps = WARMUP_PROFILES[selected].steps;
  return <form action={action} className="account-new-status-form">
    <input type="hidden" name="accountIds" value={accountId} />
    <input type="hidden" name="returnTo" value={`/contas/${accountId}`} />
    <input type="hidden" name="warmupProfile" value={enabled ? selected : "OFF"} />
    <label className="checkbox-row"><input type="checkbox" role="switch" checked={enabled} disabled={pending}
      onChange={(event) => setEnabled(event.target.checked)} />Aquecimento automático</label>
    <label>Perfil de aquecimento
      <select value={selected} disabled={pending || !enabled} onChange={(event) => setSelected(event.target.value as WarmupProfile)}>
        {Object.entries(WARMUP_PROFILES).map(([value, option]) => <option key={value} value={value}>{option.label} · {option.steps[option.steps.length - 1][0]} dias</option>)}
      </select>
    </label>
    <p className="form-hint">{steps.map(([end, limit], index) => {
      const start = index ? steps[index - 1][0] + 1 : 1;
      return `${start === end ? `Dia ${start}` : `Dias ${start}–${end}`}: até ${limit} publicações/24h`;
    }).join(" · ")}. Depois, ritmo normal.</p>
    <p className="form-hint">A contagem começa na primeira conexão. Trocar de perfil ou reconectar mantém a data original. Desligue a qualquer momento para usar o ritmo normal.</p>
    <button className="button button-secondary" disabled={pending}>{pending ? "Salvando…" : "Salvar aquecimento"}</button>
  </form>;
}

export function AccountNewStatusForm({ accountId, isNewAccount }: { accountId: string; isNewAccount: boolean }) {
  const [enabled, setEnabled] = useState(isNewAccount);
  const [, action, pending] = useActionState(saveStatus, null);
  return (
    <form action={action} className="account-new-status-form">
      <input type="hidden" name="accountIds" value={accountId} />
      <input type="hidden" name="returnTo" value={`/contas/${accountId}`} />
      <input type="hidden" name="isNewAccount" value={String(enabled)} />
      <label className="checkbox-row">
        <input type="checkbox" role="switch" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} disabled={pending} aria-describedby="account-new-status-hint" />
        Conta nova — intervalo dobrado nos loops
      </label>
      <p id="account-new-status-hint" className="form-hint">Enquanto ligada, esta opção dobra o intervalo desta conta nos loops. Desligue para voltar ao intervalo normal.</p>
      <button className="button button-secondary" disabled={pending}>{pending ? "Salvando…" : "Salvar classificação"}</button>
    </form>
  );
}
