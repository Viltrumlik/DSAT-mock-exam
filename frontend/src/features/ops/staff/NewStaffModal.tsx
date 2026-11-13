"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { Alert, Button, Field, Input, Modal, Select } from "@/components/ui";
import { peopleKeys } from "@/features/ops/changelist/peopleApi";
import { serverReason } from "@/features/ops/classrooms/classroomsApi";
import { isStaffRole, type MeLike, rolesYouMayGive } from "@/features/ops/permissions";
import { ROLE_DESCRIPTIONS, ROLE_LABELS, requiresSubject, type CanonicalRole } from "@/lib/roles";
import { staffApi } from "./staffApi";

/**
 * A new staff account (the owner's, `manage_staff`): an accountant, an administrator, a teacher. The owner sets
 * the first password and tells it to them; they change it from their profile.
 */
export function NewStaffModal({ me, onClose, onCreated }: { me: MeLike; onClose: () => void; onCreated: (id: number) => void }) {
  const queryClient = useQueryClient();
  const roles = rolesYouMayGive(me).filter(isStaffRole);
  const [form, setForm] = useState({
    first_name: "",
    last_name: "",
    email: "",
    phone_number: "",
    username: "",
    role: (roles.includes("accountant") ? "accountant" : roles[0]) as CanonicalRole,
    subject: "",
    password: "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (key: keyof typeof form) => (e: { target: { value: string } }) => setForm({ ...form, [key]: e.target.value });
  const needsSubject = requiresSubject(form.role);
  const ready =
    form.first_name.trim() && form.last_name.trim() && form.email.trim() && form.password.length >= 8 && (!needsSubject || form.subject);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const created = await staffApi.create({ ...form, subject: needsSubject ? form.subject : undefined });
      void queryClient.invalidateQueries({ queryKey: peopleKeys.all });
      onCreated(created.id);
    } catch (err) {
      setError(serverReason(err, "The account was not created. Check the details and try again."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="New staff account"
      description="For someone who works here. You set their first password and tell it to them."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={busy} disabled={!ready} onClick={() => void submit()}>
            Create account
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {error ? <Alert tone="danger">{error}</Alert> : null}
        <div className="grid grid-cols-2 gap-3">
          <Field label="First name" htmlFor="staff-first" required>
            <Input id="staff-first" autoFocus value={form.first_name} onChange={set("first_name")} />
          </Field>
          <Field label="Last name" htmlFor="staff-last" required>
            <Input id="staff-last" value={form.last_name} onChange={set("last_name")} />
          </Field>
        </div>
        <Field label="Email" htmlFor="staff-email" required>
          <Input id="staff-email" type="email" autoComplete="off" value={form.email} onChange={set("email")} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Phone" htmlFor="staff-phone">
            <Input id="staff-phone" type="tel" autoComplete="off" value={form.phone_number} onChange={set("phone_number")} />
          </Field>
          <Field label="Username" htmlFor="staff-username">
            <Input id="staff-username" autoComplete="off" value={form.username} onChange={set("username")} />
          </Field>
        </div>
        <Field label="Role" htmlFor="staff-role" hint={ROLE_DESCRIPTIONS[form.role]}>
          <Select id="staff-role" value={form.role} onChange={set("role")}>
            {roles.map((role) => (
              <option key={role} value={role}>
                {ROLE_LABELS[role]}
              </option>
            ))}
          </Select>
        </Field>
        {needsSubject ? (
          <Field label="Subject" htmlFor="staff-subject" required>
            <Select id="staff-subject" value={form.subject} onChange={set("subject")}>
              <option value="">— select —</option>
              <option value="math">Mathematics</option>
              <option value="english">English / Reading & Writing</option>
              {form.role === "support_teacher" ? <option value="both">Both (support teachers only)</option> : null}
            </Select>
          </Field>
        ) : null}
        <Field label="First password" htmlFor="staff-password" required hint="At least 8 characters.">
          <Input id="staff-password" type="password" autoComplete="new-password" value={form.password} onChange={set("password")} />
        </Field>
      </div>
    </Modal>
  );
}
