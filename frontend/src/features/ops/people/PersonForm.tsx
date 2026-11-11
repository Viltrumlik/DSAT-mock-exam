"use client";

import { useId, useState, type FormEvent, type ReactNode } from "react";
import { UserRound } from "lucide-react";
import api from "@/lib/api";
import { useToast } from "@/components/ToastProvider";
import { CANONICAL_ROLES, ROLE_LABELS, requiresSubject } from "@/lib/roles";
import { buttonClass, inputShell } from "@/features/console/ui";
import { Fieldset } from "./Fieldset";
import type { PersonCore } from "./personApi";

/**
 * The person's own fields (`PATCH /users/<id>/update/`) — only what an admin can change; the
 * read-only facts are the Overview's Summary. In three groups, with room between them, so a name,
 * a way in and a role read as three different things. The save, role/subject and error rules are
 * the old ops row editor's (EditUserModal), unchanged except:
 * - both name parts always go — the core sends them separately, so they are never guessed;
 * - no frozen flag — freezing is the page header's action, and a stale flag here would undo it;
 * - no password — the owner replaced "New password" with the header's one-time password.
 */

/** The console's field box (44 px, focus ring; quieter when lc-up decides the value) on the bare control. */
const input = (disabled = false) => inputShell({ disabled, className: "w-full outline-none placeholder:text-ms-fg-3" });

/** Under a field lc-up decides for a linked learner (``lcup.profiles``, owner 2026-10-28). */
const FROM_LCUP = "Set in lc-up — change it there; it reaches here within 15 minutes.";

/** The serializer's field errors, in the order a person reads the form. */
const ERROR_FIELDS = ["email", "phone_number", "username", "first_name", "last_name", "role", "subject"];

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

function Field({ id, label, hint, children }: { id: string; label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="min-w-0 space-y-1.5">
      <label htmlFor={id} className="block text-[14px] font-medium leading-5 text-ms-fg">
        {label}
      </label>
      {children}
      {hint ? <p className="text-[13px] leading-[18px] text-ms-fg-3">{hint}</p> : null}
    </div>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className="space-y-3">
      <legend className="text-ms-over mb-1 text-ms-fg-3">{title}</legend>
      <div className="grid gap-4 sm:grid-cols-2">{children}</div>
    </fieldset>
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
      const r = await api.patch(`/users/${person.id}/update/`, payload);
      // The serializer answers with the normalized record (e.g. the phone's canonical form).
      const saved = (r?.data ?? {}) as Partial<Record<string, string | null>>;
      if (typeof saved.first_name === "string") setFirstName(saved.first_name);
      if (typeof saved.last_name === "string") setLastName(saved.last_name);
      if (saved.username !== undefined) setUsername(saved.username ?? "");
      if (saved.email !== undefined) setEmail(saved.email ?? "");
      if (saved.phone_number !== undefined) setPhone(saved.phone_number ?? "");
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
  // lc-up's fields on a linked learner: shown, not edited — the sync would undo it within 15 minutes.
  const locked = new Set(person.lcup_locked_fields ?? []);

  return (
    <Fieldset title="Profile" icon={UserRound} description="What they are called, how they sign in, what they are">
      <form onSubmit={(e) => void save(e)} className="space-y-6" noValidate>
        <Group title="Name">
          <Field id={id("first")} label="First name" hint={locked.has("first_name") ? FROM_LCUP : undefined}>
            <input id={id("first")} value={firstName} disabled={locked.has("first_name")} onChange={(e) => setFirstName(e.target.value)} className={input(locked.has("first_name"))} />
          </Field>
          <Field id={id("last")} label="Last name" hint={locked.has("last_name") ? FROM_LCUP : undefined}>
            <input id={id("last")} value={lastName} disabled={locked.has("last_name")} onChange={(e) => setLastName(e.target.value)} className={input(locked.has("last_name"))} />
          </Field>
        </Group>

        <Group title="Sign-in and contact">
          <Field id={id("username")} label="Username">
            <input
              id={id("username")}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="off"
              className={input()}
            />
          </Field>
          <Field
            id={id("phone")}
            label="Phone"
            hint={locked.has("phone_number") ? `${FROM_LCUP} Also their login for a one-time password.` : "Also their login for a one-time password"}
          >
            <input
              id={id("phone")}
              type="tel"
              disabled={locked.has("phone_number")}
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              autoComplete="off"
              className={input(locked.has("phone_number"))}
            />
          </Field>
          <div className="sm:col-span-2">
            <Field id={id("email")} label="Email">
              <input
                id={id("email")}
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="off"
                className={input()}
              />
            </Field>
          </div>
        </Group>

        <Group title="Role">
          <Field id={id("role")} label="Role">
            <select id={id("role")} value={role} onChange={(e) => setRole(e.target.value)} className={input()}>
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
              <select id={id("subject")} value={subject} onChange={(e) => setSubject(e.target.value)} className={input()}>
                <option value="">— select —</option>
                <option value="math">Mathematics</option>
                <option value="english">English / Reading & Writing</option>
                {/* Support teachers only — a class has one subject, so a both-subject class
                    teacher is one no class could be aligned against. The server refuses it too. */}
                {role === "support_teacher" ? <option value="both">Both (support teachers only)</option> : null}
              </select>
            </Field>
          ) : null}
        </Group>

        <div className="flex flex-col-reverse items-stretch gap-3 border-t border-ms-line pt-5 sm:flex-row sm:items-center sm:justify-between">
          {error ? (
            <p role="alert" className="rounded-ms-ctl border border-ms-critical-line bg-ms-critical-soft px-3 py-2 text-[14px] text-ms-critical-fg">
              {error}
            </p>
          ) : (
            <span />
          )}
          <button
            type="submit"
            disabled={saving}
            className={buttonClass({ variant: "primary" })}
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </form>
    </Fieldset>
  );
}
