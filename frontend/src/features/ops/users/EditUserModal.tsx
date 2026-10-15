"use client";

import { useState } from "react";
import { ChevronDown, Loader2, Snowflake, X } from "lucide-react";
import api from "@/lib/api";
import { CANONICAL_ROLES, ROLE_LABELS, requiresSubject } from "@/lib/roles";

/**
 * The ops row editor (`PATCH /users/<id>/update/`) — moved here from the old /ops/users page so
 * the Students, Public users and Staff lists open the same one.
 */

/** The fields the editor reads. `/users/admin/list/` returns more; the people lists return these. */
export type UserRecord = {
  id: number;
  username: string;
  /** Null when the account has no address: a Telegram signup that has not supplied one,
   *  or one whose address was claimed by someone who proved control of it. */
  email: string | null;
  first_name: string;
  last_name: string;
  phone_number?: string | null;
  role: string;
  is_frozen: boolean;
  subject?: string | null;
};

type EditModalProps = {
  user: UserRecord;
  onClose: () => void;
  onSaved: (updated: UserRecord) => void;
  /**
   * False when `first_name`/`last_name` were guessed from a one-line display name (the people
   * lists send `name`, not the two parts). The name is then saved only if the admin edits it —
   * otherwise saving a role change would rewrite "Ali Valiyev | Karimov" as "Ali | Valiyev Karimov".
   * Defaults to true: the record is the account's own, and every field is sent as before.
   */
  namesKnown?: boolean;
};

export function EditUserModal({ user, onClose, onSaved, namesKnown = true }: EditModalProps) {
  const [firstName, setFirstName] = useState(user.first_name ?? "");
  const [lastName, setLastName] = useState(user.last_name ?? "");
  const [username, setUsername] = useState(user.username ?? "");
  const [email, setEmail] = useState(user.email ?? "");
  const [phone, setPhone] = useState(user.phone_number ?? "");
  const [role, setRole] = useState(user.role);
  const [subject, setSubject] = useState(user.subject ?? "");
  const [isFrozen, setIsFrozen] = useState(user.is_frozen);
  const [newPassword, setNewPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // NOT `role === "teacher"`. The server requires a subject for every role in
  // SUBJECT_SCOPED_STAFF_ROLES, which is teacher AND support_teacher — so the bare comparison
  // hid the field for support teachers, and the save below then sent `subject: null` into an
  // endpoint that rejects it. The role could not be created from this panel at all.
  const needsSubject = requiresSubject(role);

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      const nameEdited =
        firstName.trim() !== (user.first_name ?? "").trim() || lastName.trim() !== (user.last_name ?? "").trim();
      const payload: Record<string, unknown> = {
        ...(namesKnown || nameEdited ? { first_name: firstName.trim(), last_name: lastName.trim() } : {}),
        username: username.trim() || null,
        email: email.trim(),
        phone_number: phone.trim() || null,
        role,
        is_frozen: isFrozen,
      };
      if (needsSubject) payload.subject = subject || null;
      else payload.subject = null;
      if (newPassword.trim()) payload.password = newPassword;

      const r = await api.patch(`/users/${user.id}/update/`, payload);
      // The serializer returns the full, normalized record — trust it, then keep
      // the fields it doesn't echo back (password is write-only) from local state.
      onSaved({ ...user, ...r.data });
      onClose();
    } catch (e: unknown) {
      const data = (e as { response?: { data?: Record<string, unknown> } })?.response?.data;
      const firstFieldError = (): string | null => {
        if (!data || typeof data !== "object") return null;
        if (typeof data.detail === "string") return data.detail;
        for (const key of ["email", "phone_number", "username", "first_name", "last_name", "role", "subject", "password"]) {
          const v = data[key];
          if (Array.isArray(v) && typeof v[0] === "string") return v[0];
          if (typeof v === "string") return v;
        }
        return null;
      };
      setError(firstFieldError() ?? "Could not save changes.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Edit user"
        className="w-full max-w-md max-h-[90vh] overflow-y-auto rounded-3xl bg-card border border-border shadow-2xl p-6 space-y-5"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="font-black text-foreground text-base">
              {[user.first_name, user.last_name].filter(Boolean).join(" ") || user.email || user.username || `User ${user.id}`}
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">{user.email || "no email"}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-xl p-1.5 hover:bg-surface-2 text-muted-foreground transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Personal information */}
        <div className="space-y-3">
          <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
            Student information
          </label>
          <div className="grid grid-cols-2 gap-2">
            <input
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              placeholder="First name"
              className="rounded-xl border border-border bg-card px-3 py-2 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
            <input
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              placeholder="Last name"
              className="rounded-xl border border-border bg-card px-3 py-2 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
          </div>
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="Username"
            className="w-full rounded-xl border border-border bg-card px-3 py-2 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-primary/30"
          />
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Email"
            className="w-full rounded-xl border border-border bg-card px-3 py-2 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-primary/30"
          />
          <input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="Phone number"
            className="w-full rounded-xl border border-border bg-card px-3 py-2 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-primary/30"
          />
        </div>

        {/* Role */}
        <div className="space-y-1.5">
          <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
            Role
          </label>
          <div className="relative">
            <select
              value={role}
              onChange={(e) => setRole(e.target.value)}
              className="w-full rounded-xl border border-border bg-card px-3 py-2.5 text-sm font-semibold appearance-none pr-8"
            >
              {CANONICAL_ROLES.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABELS[r]}
                </option>
              ))}
            </select>
            <ChevronDown className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          </div>
        </div>

        {/* Subject — required by the server for every subject-scoped staff role, which is
            teacher and support_teacher. There is no create-user form in ops: staff promote an
            existing account by changing its role here, so this field appearing is the only way
            a support teacher can be made at all. */}
        {needsSubject && (
          <div className="space-y-1.5">
            <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              Subject
            </label>
            <div className="relative">
              <select
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                className="w-full rounded-xl border border-border bg-card px-3 py-2.5 text-sm font-semibold appearance-none pr-8"
              >
                <option value="">— select —</option>
                <option value="math">Mathematics</option>
                <option value="english">English / Reading & Writing</option>
                {/* Support teachers only — a classroom has one subject, so a both-subject
                    class teacher is one no class could be aligned against. The server
                    refuses it for any other role; this keeps it off screen too. */}
                {role === "support_teacher" ? (
                  <option value="both">Both (support teachers only)</option>
                ) : null}
              </select>
              <ChevronDown className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            </div>
          </div>
        )}

        {/* Status toggle */}
        <div className="space-y-2">
          <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
            Account status
          </label>
          <div className="flex flex-col gap-2">
            <label className="flex items-center justify-between rounded-xl border border-border bg-surface-2/50 px-4 py-3 cursor-pointer">
              <div className="flex items-center gap-2">
                <Snowflake className="h-4 w-4 text-blue-500" />
                <span className="text-sm font-semibold text-foreground">Frozen</span>
                <span className="text-xs text-muted-foreground">— can log in; only the frozen screen shows, every other API is blocked</span>
              </div>
              <input
                type="checkbox"
                checked={isFrozen}
                onChange={(e) => setIsFrozen(e.target.checked)}
                className="h-4 w-4 rounded accent-primary"
              />
            </label>
          </div>
        </div>

        {/* Password reset */}
        <div className="space-y-1.5">
          <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
            Reset password
          </label>
          <div className="relative">
            <input
              type={showPassword ? "text" : "password"}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="Leave blank to keep current password"
              autoComplete="new-password"
              className="w-full rounded-xl border border-border bg-card px-3 py-2 pr-16 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
            <button
              type="button"
              onClick={() => setShowPassword((s) => !s)}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg px-2 py-1 text-[11px] font-bold text-muted-foreground hover:bg-surface-2"
            >
              {showPassword ? "Hide" : "Show"}
            </button>
          </div>
        </div>

        {error && (
          <p className="rounded-xl bg-red-50 border border-red-200 px-3 py-2 text-sm font-semibold text-red-700">
            {error}
          </p>
        )}

        <div className="flex gap-2 pt-1">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 rounded-xl border border-border px-4 py-2.5 text-sm font-bold text-foreground hover:bg-surface-2 transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={saving}
            className="flex-1 rounded-xl bg-foreground px-4 py-2.5 text-sm font-bold text-background hover:opacity-90 transition-opacity disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Save changes
          </button>
        </div>
      </div>
    </div>
  );
}
