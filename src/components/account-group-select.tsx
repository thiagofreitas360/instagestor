"use client";

import { setAccountGroupAction } from "@/app/actions";

type Group = { id: string; name: string };

export function AccountGroupSelect({ accountId, username, groups, currentIds, returnTo }: {
  accountId: string; username: string; groups: Group[]; currentIds: string[]; returnTo: string;
}) {
  const multiple = currentIds.length > 1;
  const value = multiple ? "__multiple" : (currentIds[0] ?? "");

  return (
    <form action={setAccountGroupAction} className="group-select-form">
      <input type="hidden" name="accountId" value={accountId} />
      <input type="hidden" name="returnTo" value={returnTo} />
      <select
        name="groupId"
        className="group-select"
        defaultValue={value}
        aria-label={`Grupo de @${username}`}
        onChange={(event) => {
          if (multiple && !window.confirm(`@${username} está em ${currentIds.length} grupos. Mover só para o escolhido?`)) {
            event.target.value = value;
            return;
          }
          event.target.form?.requestSubmit();
        }}
      >
        {multiple ? <option value="__multiple" disabled>{currentIds.length} grupos</option> : null}
        <option value="">Sem grupo</option>
        {groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}
      </select>
    </form>
  );
}
