"use client";

import { useActionState, useRef, useState } from "react";
import { bulkMediaAction } from "@/app/actions";

async function applyOperation(_previous: null, formData: FormData) {
  await bulkMediaAction(formData);
  return null;
}

export function MediaBulkSelection({ children, folders, returnTo, total }: {
  children: React.ReactNode;
  folders: Array<{ id: string; name: string }>;
  returnTo: string;
  total: number;
}) {
  const root = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState(0);
  const [, action, pending] = useActionState(applyOperation, null);

  function updateSelection(checked?: boolean) {
    const inputs = Array.from(root.current?.querySelectorAll<HTMLInputElement>('input[name="mediaIds"]') ?? []);
    if (checked !== undefined) inputs.forEach((input) => { input.checked = checked; });
    setSelected(inputs.filter((input) => input.checked).length);
  }

  return (
    <div className="media-bulk-selection" ref={root} onChange={(event) => {
      if (event.target instanceof HTMLInputElement && event.target.name === "mediaIds") updateSelection();
    }}>
      <form id="media-bulk-form" className="media-bulk-toolbar" action={action} onReset={() => updateSelection(false)}>
        <input type="hidden" name="returnTo" value={returnTo} />
        <div className="media-bulk-summary">
          <button className="button button-small button-secondary" type="button" disabled={pending} onClick={() => updateSelection(true)}>
            Selecionar todas ({total})
          </button>
          <span role="status" aria-live="polite">{pending ? "Aplicando ação…" : `${selected} ${selected === 1 ? "mídia selecionada" : "mídias selecionadas"}`}</span>
          <button className="button button-small button-ghost" type="button" disabled={pending || !selected} onClick={() => updateSelection(false)}>
            Limpar seleção
          </button>
        </div>
        <div className="media-bulk-actions">
          <label>
            Pasta de destino
            <select name="folderId" disabled={pending || !selected} defaultValue="">
              <option value="">Sem pasta</option>
              {folders.map((folder) => <option key={folder.id} value={folder.id}>{folder.name}</option>)}
            </select>
          </label>
          <button className="button button-small button-primary" name="operation" value="move" disabled={pending || !selected}>
            Mover selecionadas
          </button>
          <button className="button button-small button-quiet-danger" name="operation" value="delete" disabled={pending || !selected} onClick={(event) => {
            if (!window.confirm(`Excluir ${selected} ${selected === 1 ? "mídia selecionada" : "mídias selecionadas"}? Esta ação não pode ser desfeita.`)) event.preventDefault();
          }}>
            Excluir selecionadas
          </button>
        </div>
        <p className="form-hint">A seleção inclui apenas os arquivos deste filtro. Se alguma mídia não puder ser movida ou excluída, nenhuma será alterada.</p>
      </form>
      <fieldset className="media-selection-fields" disabled={pending}>
        <legend className="sr-only">Selecionar mídias para ações em lote</legend>
        {children}
      </fieldset>
    </div>
  );
}
