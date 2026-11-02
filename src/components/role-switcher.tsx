"use client";

import { useId, useState, useTransition } from "react";
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
  const [failed, setFailed] = useState(false);

  return (
    <div className="flex items-center gap-2">
      <label htmlFor={selectId} className="caption-4 text-ink-soft">
        {t("label")}
      </label>
      <select
        id={selectId}
        value={activeId}
        disabled={pending}
        onChange={(event) => {
          const id = event.target.value;
          startTransition(async () => {
            const result = await setActiveRole(id);
            setFailed(!result.ok);
          });
        }}
        className="press min-h-11 rounded-full bg-step px-4 title-4 text-ink hover:bg-step-deep disabled:opacity-50"
      >
        {memberships.map((m) => (
          <option key={m.id} value={m.id}>
            {roles(m.role)}
          </option>
        ))}
      </select>
      {failed ? (
        <span role="alert" className="body-6 text-bad">
          {t("error")}
        </span>
      ) : null}
    </div>
  );
}
