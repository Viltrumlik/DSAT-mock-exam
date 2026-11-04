"use client";

import { useId, useState, type FormEvent } from "react";
import { Phone } from "lucide-react";
import api from "@/lib/api";
import { useToast } from "@/components/ToastProvider";
import { serverReason } from "@/features/ops/classrooms/classroomsApi";
import { Fieldset } from "./Fieldset";

/**
 * Whom an admin calls about a learner. The server gives these to admins alone, so anyone else never gets
 * this box. SMS stays on the student's own phone.
 */

const INPUT =
  "h-10 w-full rounded-lg border border-border bg-card px-3 text-sm text-foreground placeholder:text-muted-foreground focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30";

export function ParentCard({
  id,
  parent,
  onSaved,
}: {
  id: number;
  parent: { name: string; phone: string };
  onSaved: () => void;
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
            <label htmlFor={`${uid}-name`} className="block text-sm font-medium text-foreground">
              Name
            </label>
            <input id={`${uid}-name`} value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" className={INPUT} />
          </div>
          <div className="min-w-0 space-y-1.5">
            <label htmlFor={`${uid}-phone`} className="block text-sm font-medium text-foreground">
              Phone
            </label>
            <input id={`${uid}-phone`} type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} autoComplete="off" className={INPUT} />
          </div>
        </div>
        <div className="flex flex-col-reverse items-stretch gap-3 sm:flex-row sm:items-center sm:justify-between">
          {error ? (
            <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger-foreground">
              {error}
            </p>
          ) : (
            <span />
          )}
          <button
            type="submit"
            disabled={saving}
            className="h-10 rounded-lg bg-primary px-5 text-sm font-semibold text-primary-foreground shadow-sm hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </form>
    </Fieldset>
  );
}
