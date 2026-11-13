"use client";

import { useId, useState, type FormEvent } from "react";
import { Phone } from "lucide-react";
import api from "@/lib/api";
import { useToast } from "@/components/ToastProvider";
import { serverReason } from "@/features/ops/classrooms/classroomsApi";
import { buttonClass, inputShell } from "@/features/console/ui";
import { Fieldset } from "./Fieldset";

/**
 * Whom an admin calls about a learner. The server gives these to admins alone, so anyone else never gets
 * this box. SMS stays on the student's own phone.
 */

/** The console's field box (44 px, focus ring) on the bare input. */
const INPUT = inputShell({ className: "w-full outline-none placeholder:text-ms-fg-3" });

export function ParentCard({
  id,
  parent,
  onSaved,
  readOnly = false,
}: {
  id: number;
  parent: { name: string; phone: string };
  onSaved: () => void;
  /** Without `edit_people` the parent's contact is shown, not changed. */
  readOnly?: boolean;
}) {
  const uid = useId();
  const { push } = useToast();
  const [name, setName] = useState(parent.name);
  const [phone, setPhone] = useState(parent.phone);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await api.patch(`/users/admin/people/${id}/parent/`, { parent_name: name.trim(), parent_phone: phone.trim() });
      push({ tone: "success", message: "Saved." });
      onSaved();
    } catch (err: unknown) {
      setError(serverReason(err, "Could not save changes."));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Fieldset title="Parent" icon={Phone} description="Whom to call. Only admins see this.">
      <form onSubmit={(e) => void save(e)} className="space-y-4" noValidate>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="min-w-0 space-y-1.5">
            <label htmlFor={`${uid}-name`} className="block text-[14px] font-medium leading-5 text-ms-fg">
              Name
            </label>
            <input disabled={readOnly} id={`${uid}-name`} value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" className={INPUT} />
          </div>
          <div className="min-w-0 space-y-1.5">
            <label htmlFor={`${uid}-phone`} className="block text-[14px] font-medium leading-5 text-ms-fg">
              Phone
            </label>
            <input disabled={readOnly} id={`${uid}-phone`} type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} autoComplete="off" className={INPUT} />
          </div>
        </div>
        <div className="flex flex-col-reverse items-stretch gap-3 sm:flex-row sm:items-center sm:justify-between">
          {error ? (
            <p role="alert" className="rounded-ms-ctl border border-ms-critical-line bg-ms-critical-soft px-3 py-2 text-[14px] text-ms-critical-fg">
              {error}
            </p>
          ) : (
            <span />
          )}
          {readOnly ? null : (
            <button type="submit" disabled={saving} className={buttonClass({ variant: "primary" })}>
              {saving ? "Saving…" : "Save"}
            </button>
          )}
        </div>
      </form>
    </Fieldset>
  );
}
