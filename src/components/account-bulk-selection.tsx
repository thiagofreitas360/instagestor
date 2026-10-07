"use client";

import { useActionState, useRef, useState } from "react";
import { setAccountsNewStatusAction } from "@/app/actions";

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
          <button className="button button-small button-primary" name="isNewAccount" value="true" disabled={pending}>Marcar como novas</button>
          <button className="button button-small button-secondary" name="isNewAccount" value="false" disabled={pending}>Marcar como antigas</button>
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
