"use client";

import { useId, useTransition } from "react";
import { useTranslations } from "next-intl";
import { setActiveRole } from "@/app/actions/active-role";
import type { Role } from "@/modules/identity/policies";

export type SwitcherMembership = {
  id: string;
  role: Role;
  cooperativeId: string | null;
};

export function RoleSwitcher({
  memberships,
  activeId,
}: {
  memberships: SwitcherMembership[];
  activeId: string;
}) {
  const t = useTranslations("roleSwitcher");
  const roles = useTranslations("roles");
  const [pending, startTransition] = useTransition();
  const selectId = useId();

  return (
    <div className="flex items-center gap-2">
      <label htmlFor={selectId} className="text-sm text-muted">
        {t("label")}
      </label>
      <select
        id={selectId}
        value={activeId}
        disabled={pending}
        onChange={(event) => {
          const id = event.target.value;
          startTransition(async () => {
            await setActiveRole(id);
          });
        }}
        className="min-h-11 rounded-md border border-border bg-surface px-3 text-base text-fg"
      >
        {memberships.map((m) => (
          <option key={m.id} value={m.id}>
            {roles(m.role)}
          </option>
        ))}
      </select>
    </div>
  );
}
