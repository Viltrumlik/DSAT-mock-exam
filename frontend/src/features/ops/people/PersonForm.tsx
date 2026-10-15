"use client";

import { useId, useState, type FormEvent, type ReactNode } from "react";
import api from "@/lib/api";
import { useToast } from "@/components/ToastProvider";
import { CANONICAL_ROLES, ROLE_LABELS, requiresSubject } from "@/lib/roles";
import { Fieldset } from "./Fieldset";
import type { PersonCore } from "./personApi";

/**
 * The person's own fields (`PATCH /users/<id>/update/`) — only what an admin can change; the
 * read-only facts are the Overview's Summary card. The save, role/subject and error rules are the
 * old ops row editor's (EditUserModal), unchanged except:
 * - both name parts always go — the core sends them separately, so they are never guessed;
 * - no frozen flag — freezing is the page header's action, and a stale flag here would undo it.
 */

const INPUT =
  "h-8 w-full rounded-md border border-border bg-card px-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30";

/** The serializer's field errors, in the order a person reads the form. */
const ERROR_FIELDS = ["email", "phone_number", "username", "first_name", "last_name", "role", "subject", "password"];

function firstFieldError(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  if (typeof d.detail === "string") return d.detail;
  for (const key of ERROR_FIELDS) {
    const v = d[key];
    if (Array.isArray(v) && typeof v[0] === "string") return v[0];
    if (typeof v === "string") return v;
  }
  return null;
}

function Field({ id, label, children }: { id: string; label: string; children: ReactNode }) {
  return (
    <div className="min-w-0 space-y-1">
      <label htmlFor={id} className="block text-xs text-muted-foreground">
        {label}
      </label>
      {children}
    </div>
  );
}

export function PersonForm({ person, onSaved }: { person: PersonCore; onSaved: () => void }) {
  const uid = useId();
  const { push } = useToast();
  const [firstName, setFirstName] = useState(person.first_name);
  const [lastName, setLastName] = useState(person.last_name);
  const [username, setUsername] = useState(person.username);
  const [email, setEmail] = useState(person.email);
  const [phone, setPhone] = useState(person.phone);
  const [role, setRole] = useState(person.role);
  const [subject, setSubject] = useState(person.subject);
  const [newPassword, setNewPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Every subject-scoped staff role (teacher AND support_teacher) needs a subject; the server
  // refuses one without it, and refuses one on any other role.
  const needsSubject = requiresSubject(role);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const payload: Record<string, unknown> = {
        first_name: firstName.trim(),
        last_name: lastName.trim(),
        username: username.trim() || null,
        email: email.trim(),
        phone_number: phone.trim() || null,
        role,
        subject: needsSubject ? subject || null : null,
      };
      if (newPassword.trim()) payload.password = newPassword;

      const r = await api.patch(`/users/${person.id}/update/`, payload);
      // The serializer answers with the normalized record (e.g. the phone's canonical form).
      const saved = (r?.data ?? {}) as Partial<Record<string, string | null>>;
      if (typeof saved.first_name === "string") setFirstName(saved.first_name);
      if (typeof saved.last_name === "string") setLastName(saved.last_name);
      if (saved.username !== undefined) setUsername(saved.username ?? "");
      if (saved.email !== undefined) setEmail(saved.email ?? "");
      if (saved.phone_number !== undefined) setPhone(saved.phone_number ?? "");
      setNewPassword("");
      setShowPassword(false);
      push({ tone: "success", message: "Saved." });
      onSaved();
    } catch (err: unknown) {
      const data = (err as { response?: { data?: unknown } })?.response?.data;
      setError(firstFieldError(data) ?? "Could not save changes.");
    } finally {
      setSaving(false);
    }
  };

  const id = (name: string) => `${uid}-${name}`;

  return (
    <Fieldset title="Profile">
      <form onSubmit={(e) => void save(e)} className="space-y-4" noValidate>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field id={id("first")} label="First name">
            <input id={id("first")} value={firstName} onChange={(e) => setFirstName(e.target.value)} className={INPUT} />
          </Field>
          <Field id={id("last")} label="Last name">
            <input id={id("last")} value={lastName} onChange={(e) => setLastName(e.target.value)} className={INPUT} />
          </Field>
          <Field id={id("username")} label="Username">
            <input
              id={id("username")}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="off"
              className={INPUT}
            />
          </Field>
          <Field id={id("email")} label="Email">
            <input
              id={id("email")}
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="off"
              className={INPUT}
            />
          </Field>
          <Field id={id("phone")} label="Phone">
            <input
              id={id("phone")}
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              autoComplete="off"
              className={INPUT}
            />
          </Field>
          <Field id={id("role")} label="Role">
            <select id={id("role")} value={role} onChange={(e) => setRole(e.target.value)} className={INPUT}>
              {CANONICAL_ROLES.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABELS[r]}
                </option>
              ))}
            </select>
          </Field>
          {/* There is no create-staff form in ops: an account becomes a (support) teacher by
              changing its role here, so this field appearing is the only way to give one a subject. */}
          {needsSubject ? (
            <Field id={id("subject")} label="Subject">
              <select id={id("subject")} value={subject} onChange={(e) => setSubject(e.target.value)} className={INPUT}>
                <option value="">— select —</option>
                <option value="math">Mathematics</option>
                <option value="english">English / Reading & Writing</option>
                {/* Support teachers only — a class has one subject, so a both-subject class
                    teacher is one no class could be aligned against. The server refuses it too. */}
                {role === "support_teacher" ? <option value="both">Both (support teachers only)</option> : null}
              </select>
            </Field>
          ) : null}
          <Field id={id("password")} label="New password">
            <div className="flex gap-2">
              <input
                id={id("password")}
                type={showPassword ? "text" : "password"}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="Leave blank to keep"
                autoComplete="new-password"
                className={INPUT}
              />
              <button
                type="button"
                onClick={() => setShowPassword((s) => !s)}
                aria-pressed={showPassword}
                className="h-8 shrink-0 rounded-md border border-border bg-card px-2.5 text-[13px] text-foreground hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                {showPassword ? "Hide" : "Show"}
              </button>
            </div>
          </Field>
        </div>

        <div className="space-y-2 border-t border-border pt-3">
          {error ? (
            <p role="alert" className="text-foreground">
              {error}
            </p>
          ) : null}
          <div className="flex justify-end">
            <button
              type="submit"
              disabled={saving}
              className="h-8 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      </form>
    </Fieldset>
  );
}
