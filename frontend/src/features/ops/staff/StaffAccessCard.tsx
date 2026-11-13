"use client";

import { useState } from "react";
import { KeyRound } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useToast } from "@/components/ToastProvider";
import { Button } from "@/features/console/ui";
import { serverReason } from "@/features/ops/classrooms/classroomsApi";
import { ConfirmDialog } from "@/features/ops/people/ConfirmDialog";
import { Fieldset } from "@/features/ops/people/Fieldset";
import { ROLE_LABELS, type CanonicalRole } from "@/lib/roles";
import { PERMISSION_LABELS, staffApi, staffKeys, type StaffPermissions } from "./staffApi";

/**
 * A staff person's permissions and access, on their page, for the owner alone (`manage_staff`).
 *
 * Each permission is ticked when the person holds it. A tick the owner changes stands apart from the role's
 * preset ("changed"); setting it back to the preset clears it. "Turn off access" is for an employee who leaves:
 * the account can no longer sign in and every device is signed out.
 */
export function StaffAccessCard({
  id,
  name,
  active,
  onChanged,
}: {
  id: number;
  name: string;
  active: boolean;
  onChanged: () => void;
}) {
  const { push } = useToast();
  const queryClient = useQueryClient();
  const q = useQuery({ queryKey: staffKeys.permissions(id), queryFn: () => staffApi.permissions(id) });
  const [confirmOff, setConfirmOff] = useState(false);

  const tick = useMutation({
    mutationFn: (ticks: Record<string, boolean | null>) => staffApi.setTicks(id, ticks),
    onSuccess: (state) => {
      queryClient.setQueryData(staffKeys.permissions(id), state);
      onChanged();
    },
    onError: (err) => push({ tone: "error", message: serverReason(err, "The permission did not change. Try again.") }),
  });

  const access = useMutation({
    mutationFn: (next: boolean) => staffApi.setAccess(id, next),
    onSuccess: (res) => {
      push({
        tone: "success",
        message: res.active
          ? `${name} can sign in again.`
          : `${name}'s access is off; signed out of ${res.revoked} device${res.revoked === 1 ? "" : "s"}.`,
      });
      setConfirmOff(false);
      onChanged();
    },
    onError: (err) => push({ tone: "error", message: serverReason(err, "That did not go through. Try again.") }),
  });

  const toggle = (state: StaffPermissions, code: string) => {
    const now = state.effective.includes(code);
    const inPreset = state.preset.includes(code);
    // Back to the role's preset clears the tick; anything else is the owner's exception.
    tick.mutate({ [code]: !now === inPreset ? null : !now });
  };

  const roleLabel = (role: string) => ROLE_LABELS[role as CanonicalRole] ?? role;

  return (
    <Fieldset
      title="Permissions"
      icon={KeyRound}
      description="What the role gives, and your exceptions for this person. Only you change these."
    >
      <div className="space-y-4">
        {q.isPending ? <p className="text-[14px] text-ms-fg-3">Loading…</p> : null}
        {q.isError ? <p className="text-[14px] text-ms-critical-fg">Could not load the permissions.</p> : null}
        {q.data ? (
          <ul className="grid gap-1.5 sm:grid-cols-2" aria-label="Permissions">
            {q.data.tickable.map((code) => {
              const state = q.data;
              const held = state.effective.includes(code);
              const changed = code in state.ticks;
              return (
                <li key={code}>
                  <label className="flex items-center gap-2 text-[14px] text-ms-fg">
                    <input type="checkbox" checked={held} disabled={tick.isPending} onChange={() => toggle(state, code)} />
                    <span>{PERMISSION_LABELS[code] ?? code}</span>
                    {changed ? <span className="text-[12px] text-ms-fg-3">changed</span> : null}
                  </label>
                </li>
              );
            })}
          </ul>
        ) : null}
        {q.data ? (
          <p className="text-[13px] text-ms-fg-3">Role: {roleLabel(q.data.role)}. Unticked means they do not have it.</p>
        ) : null}
        <div className="flex justify-end border-t border-ms-line pt-4">
          {active ? (
            <Button variant="secondary" disabled={access.isPending} onClick={() => setConfirmOff(true)}>
              Turn off access
            </Button>
          ) : (
            <Button disabled={access.isPending} onClick={() => access.mutate(true)}>
              Turn access back on
            </Button>
          )}
        </div>
      </div>
      {confirmOff ? (
        <ConfirmDialog
          title={`Turn off ${name}'s access?`}
          body="They can no longer sign in, and every device they use is signed out now. Their account and its history stay; you can turn access back on."
          confirmLabel="Turn off access"
          danger
          busy={access.isPending}
          onConfirm={() => access.mutate(false)}
          onCancel={() => (access.isPending ? undefined : setConfirmOff(false))}
        />
      ) : null}
    </Fieldset>
  );
}
