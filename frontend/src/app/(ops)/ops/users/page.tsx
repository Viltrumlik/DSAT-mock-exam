"use client";

import { useEffect, useMemo, useState } from "react";
import api from "@/lib/api";
import {
  Search,
  UserCheck,
  RefreshCw,
  Users,
  ChevronDown,
  Snowflake,
  ShieldAlert,
  Loader2,
  MailCheck,
  MailQuestion,
  Trash2,
  X,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { useToast } from "@/components/ToastProvider";

type UserRecord = {
  id: number;
  username: string;
  email: string;
  first_name: string;
  last_name: string;
  phone_number?: string | null;
  role: string;
  is_active: boolean;
  is_frozen: boolean;
  subject?: string | null;
  date_joined?: string;
  last_login?: string | null;
  email_verified?: boolean;
  email_verified_at?: string | null;
  email_released_at?: string | null;
  previous_email?: string | null;
  /** Graded/submitted rows this account holds. Also the delete blast radius. */
  attempt_count?: number;
};

type RoleFilter = "all" | "student" | "teacher" | "test_admin" | "admin" | "super_admin";

/** Normalized full name, used to group duplicate registrations. */
function fullNameKey(u: UserRecord): string {
  return `${u.first_name ?? ""} ${u.last_name ?? ""}`.trim().replace(/\s+/g, " ").toLowerCase();
}

// ─── Bulk actions ────────────────────────────────────────────────────────────

type BulkAction = "freeze" | "unfreeze" | "delete";

type BulkResult = {
  id: number;
  ok: boolean;
  is_frozen?: boolean;
  deleted?: boolean;
  error?: string;
};

const ACTION_LABEL: Record<BulkAction, string> = {
  freeze: "Freeze",
  unfreeze: "Unfreeze",
  delete: "Delete",
};

const ACTION_PAST: Record<BulkAction, string> = {
  freeze: "frozen",
  unfreeze: "unfrozen",
  delete: "deleted",
};

const ALL_ROLES = ["student", "teacher", "test_admin", "admin", "super_admin"] as const;

const ROLE_LABELS: Record<string, string> = {
  student: "Student",
  teacher: "Teacher",
  test_admin: "Test admin",
  admin: "Admin",
  super_admin: "Super admin",
};

const ROLE_COLORS: Record<string, string> = {
  student: "bg-blue-100 text-blue-800",
  teacher: "bg-teal-100 text-teal-800",
  test_admin: "bg-amber-100 text-amber-800",
  admin: "bg-purple-100 text-purple-800",
  super_admin: "bg-red-100 text-red-800",
};

function formatDate(s?: string): string {
  if (!s) return "—";
  try {
    return new Date(s).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return s;
  }
}

// ─── Inline edit modal ───────────────────────────────────────────────────────

type EditModalProps = {
  user: UserRecord;
  onClose: () => void;
  onSaved: (updated: UserRecord) => void;
};

function EditUserModal({ user, onClose, onSaved }: EditModalProps) {
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

  const needsSubject = role === "teacher";

  const handleSave = async () => {
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
        className="w-full max-w-md max-h-[90vh] overflow-y-auto rounded-3xl bg-card border border-border shadow-2xl p-6 space-y-5"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="font-black text-foreground text-base">
              {[user.first_name, user.last_name].filter(Boolean).join(" ") || user.email}
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">{user.email}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
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
              {ALL_ROLES.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABELS[r]}
                </option>
              ))}
            </select>
            <ChevronDown className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          </div>
        </div>

        {/* Subject — only for teachers */}
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

// ─── Bulk confirmation modal ─────────────────────────────────────────────────

function ConfirmBulkModal({
  action,
  count,
  attemptTotal,
  busy,
  onCancel,
  onConfirm,
}: {
  action: BulkAction;
  count: number;
  /** Graded/submitted rows across the selection. Every relation is CASCADE. */
  attemptTotal: number;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const [typed, setTyped] = useState("");
  const isDelete = action === "delete";
  const canConfirm = !busy && (!isDelete || typed.trim().toUpperCase() === "DELETE");
  const noun = `${count} account${count === 1 ? "" : "s"}`;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4" onClick={onCancel}>
      <div
        className="w-full max-w-sm rounded-3xl bg-card border border-border shadow-2xl p-6 space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2">
          {isDelete ? (
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-red-50 text-red-600">
              <Trash2 className="h-4.5 w-4.5" />
            </span>
          ) : (
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <ShieldAlert className="h-4.5 w-4.5" />
            </span>
          )}
          <p className="font-black text-foreground text-base">
            {ACTION_LABEL[action]} {noun}?
          </p>
        </div>

        <p className="text-sm text-muted-foreground">
          {isDelete
            ? `This permanently deletes ${noun}. This cannot be undone.`
            : `This will ${ACTION_LABEL[action].toLowerCase()} ${noun}. You can reverse it later.`}
        </p>

        {/* Deleting a user cascades to every attempt, submission and result they own.
            Without this line the dialog looks identical whether you picked the empty
            duplicate or the one holding a year of work. */}
        {isDelete && attemptTotal > 0 && (
          <p className="rounded-xl bg-red-50 px-3 py-2 text-sm font-bold text-red-700">
            {attemptTotal.toLocaleString()} exam {attemptTotal === 1 ? "result" : "results"} will be
            permanently deleted with {count === 1 ? "this account" : "these accounts"}.
          </p>
        )}

        {isDelete && (
          <div className="space-y-1.5">
            <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              Type DELETE to confirm
            </label>
            <input
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              placeholder="DELETE"
              className="w-full rounded-xl border border-border bg-card px-3 py-2 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-red-300"
            />
          </div>
        )}

        <div className="flex gap-2 pt-1">
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 rounded-xl border border-border px-4 py-2.5 text-sm font-bold text-foreground hover:bg-surface-2 transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={!canConfirm}
            className={cn(
              "flex-1 rounded-xl px-4 py-2.5 text-sm font-bold text-background transition-opacity disabled:opacity-50 flex items-center justify-center gap-2",
              isDelete ? "bg-red-600 hover:bg-red-700 text-white" : "bg-foreground hover:opacity-90",
            )}
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {ACTION_LABEL[action]}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Main page ───────────────────────────────────────────────────────────────

export default function OpsUsersPage() {
  const [users, setUsers] = useState<UserRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<RoleFilter>("all");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "frozen">("all");
  const [verifiedFilter, setVerifiedFilter] = useState<"all" | "verified" | "unverified">("all");
  // Duplicate registrations are the reason this screen grew a verified column: prod has
  // 36 same-name groups covering 89 of 387 accounts, mostly one person who signed up
  // twice with a near-identical address.
  const [duplicatesOnly, setDuplicatesOnly] = useState(false);
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<UserRecord | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [pendingAction, setPendingAction] = useState<BulkAction | null>(null);
  const { push } = useToast();
  const PAGE_SIZE = 50;

  const loadUsers = async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await api.get("/users/admin/list/", {
        params: {
          limit: 500,
          offset: 0,
          ...(roleFilter !== "all" ? { role: roleFilter } : {}),
        },
      });
      const items: UserRecord[] = Array.isArray(r.data)
        ? r.data
        : Array.isArray(r.data?.results)
          ? r.data.results
          : [];
      setUsers(items);
      setPage(1);
    } catch (e: unknown) {
      const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(
        typeof detail === "string"
          ? detail
          : "Could not load users. Ensure you have manage_users permission.",
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadUsers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roleFilter]);

  const handleSaved = (updated: UserRecord) => {
    setUsers((prev) => prev.map((u) => (u.id === updated.id ? updated : u)));
  };

  const filtered = useMemo(() => {
    let result = users;
    if (search.trim().length >= 2) {
      const term = search.toLowerCase().trim();
      result = result.filter(
        (u) =>
          u.username?.toLowerCase().includes(term) ||
          u.email?.toLowerCase().includes(term) ||
          `${u.first_name} ${u.last_name}`.toLowerCase().includes(term),
      );
    }
    if (statusFilter === "active") result = result.filter((u) => !u.is_frozen);
    if (statusFilter === "frozen") result = result.filter((u) => u.is_frozen);
    if (verifiedFilter === "verified") result = result.filter((u) => u.email_verified);
    if (verifiedFilter === "unverified") result = result.filter((u) => !u.email_verified);
    if (duplicatesOnly) {
      // Group across the WHOLE list, not the filtered subset — otherwise narrowing by
      // role or status hides one half of a pair and the remaining row stops looking
      // like a duplicate.
      const counts = new Map<string, number>();
      for (const u of users) {
        const k = fullNameKey(u);
        if (k) counts.set(k, (counts.get(k) ?? 0) + 1);
      }
      result = result
        .filter((u) => (counts.get(fullNameKey(u)) ?? 0) > 1)
        // Group members adjacent, and within a group put the row most likely worth
        // keeping first: verified, then most work, then oldest.
        .sort((a, b) => {
          const k = fullNameKey(a).localeCompare(fullNameKey(b));
          if (k !== 0) return k;
          if (!!a.email_verified !== !!b.email_verified) return a.email_verified ? -1 : 1;
          const diff = (b.attempt_count ?? 0) - (a.attempt_count ?? 0);
          if (diff !== 0) return diff;
          return a.id - b.id;
        });
    }
    return result;
  }, [users, search, statusFilter, verifiedFilter, duplicatesOnly]);

  const paginated = useMemo(
    () => filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    [filtered, page],
  );

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));

  // ── Selection ──────────────────────────────────────────────────────────────
  const pageIds = useMemo(() => paginated.map((u) => u.id), [paginated]);
  const allOnPageSelected = pageIds.length > 0 && pageIds.every((id) => selected.has(id));

  const toggleOne = (id: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAllOnPage = () => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allOnPageSelected) pageIds.forEach((id) => next.delete(id));
      else pageIds.forEach((id) => next.add(id));
      return next;
    });
  };

  const clearSelection = () => setSelected(new Set());

  // ── Single freeze/unfreeze (row buttons) ─────────────────────────────────────
  const setFrozenSingle = async (u: UserRecord, next: boolean) => {
    try {
      await api.patch(`/users/${u.id}/update/`, { is_frozen: next });
      setUsers((prev) => prev.map((x) => (x.id === u.id ? { ...x, is_frozen: next } : x)));
      push({ tone: "success", message: next ? "Account frozen." : "Account unfrozen." });
    } catch {
      push({ tone: "error", message: "Could not update account." });
    }
  };

  // ── Bulk actions ─────────────────────────────────────────────────────────────
  const runBulk = async (action: BulkAction) => {
    const ids = [...selected];
    if (ids.length === 0) return;
    setBulkBusy(true);
    try {
      const r = await api.post("/users/admin/bulk/", { action, ids });
      const results: BulkResult[] = Array.isArray(r.data?.results) ? r.data.results : [];
      const okResults = results.filter((x) => x.ok);
      const okCount = okResults.length;
      const failCount = results.length - okCount;

      if (action === "delete") {
        const deleted = new Set(okResults.map((x) => x.id));
        setUsers((prev) => prev.filter((u) => !deleted.has(u.id)));
      } else {
        const okMap = new Map(okResults.map((x) => [x.id, x]));
        setUsers((prev) =>
          prev.map((u) => {
            const res = okMap.get(u.id);
            if (!res) return u;
            return {
              ...u,
              ...(typeof res.is_frozen === "boolean" ? { is_frozen: res.is_frozen } : {}),
            };
          }),
        );
      }

      clearSelection();
      const verb = ACTION_PAST[action];
      if (okCount === 0) {
        push({ tone: "error", message: `Nothing ${verb} — ${failCount} skipped.` });
      } else if (failCount === 0) {
        push({ tone: "success", message: `${okCount} account${okCount === 1 ? "" : "s"} ${verb}.` });
      } else {
        push({ tone: "error", message: `${okCount} ${verb}, ${failCount} skipped.` });
      }
    } catch {
      push({ tone: "error", message: "Bulk action failed. Please try again." });
    } finally {
      setBulkBusy(false);
      setPendingAction(null);
    }
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-[10px] font-bold text-primary uppercase tracking-widest mb-1.5">
            Admin console · Users
          </p>
          <h1 className="text-xl font-bold text-foreground tracking-tight">User management</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Click any user row to edit their role, status, or subject.
          </p>
        </div>
        <button
          type="button"
          onClick={loadUsers}
          className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-card px-3 py-2 text-sm font-bold text-foreground hover:bg-surface-2 transition-colors"
        >
          <RefreshCw className="h-4 w-4" />
          Refresh
        </button>
      </div>

      {/* Error */}
      {error && (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-700">
          {error}
          <button
            type="button"
            onClick={loadUsers}
            className="ml-3 underline font-bold hover:no-underline"
          >
            Retry
          </button>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
          <input
            type="search"
            placeholder="Search by name, email, or username…"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            className="w-full rounded-xl border border-border bg-card pl-9 pr-4 py-2 text-sm font-medium placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
          />
        </div>
        <select
          value={roleFilter}
          onChange={(e) => { setRoleFilter(e.target.value as RoleFilter); setPage(1); }}
          className="rounded-xl border border-border bg-card px-3 py-2 text-sm font-semibold"
        >
          <option value="all">All roles</option>
          <option value="student">Students</option>
          <option value="teacher">Teachers</option>
          <option value="test_admin">Test admins</option>
          <option value="admin">Admins</option>
          <option value="super_admin">Super admins</option>
        </select>
        <select
          value={statusFilter}
          onChange={(e) => { setStatusFilter(e.target.value as typeof statusFilter); setPage(1); }}
          className="rounded-xl border border-border bg-card px-3 py-2 text-sm font-semibold"
        >
          <option value="all">All statuses</option>
          <option value="active">Active</option>
          <option value="frozen">Frozen</option>
        </select>
        <select
          value={verifiedFilter}
          onChange={(e) => { setVerifiedFilter(e.target.value as typeof verifiedFilter); setPage(1); }}
          className="rounded-xl border border-border bg-card px-3 py-2 text-sm font-semibold"
        >
          <option value="all">Any email</option>
          <option value="verified">Email verified</option>
          <option value="unverified">Email unverified</option>
        </select>
        <button
          type="button"
          onClick={() => { setDuplicatesOnly((v) => !v); setPage(1); }}
          aria-pressed={duplicatesOnly}
          className={cn(
            "rounded-xl border px-3 py-2 text-sm font-semibold transition-colors",
            duplicatesOnly
              ? "border-primary bg-primary/10 text-primary"
              : "border-border bg-card text-foreground hover:bg-surface-2/50",
          )}
        >
          Duplicate names
        </button>
      </div>

      {/* Bulk action toolbar */}
      {selected.size > 0 && (
        <div className="sticky top-2 z-30 flex flex-wrap items-center gap-2 rounded-2xl border border-primary/30 bg-primary/5 px-4 py-3 shadow-sm backdrop-blur">
          <span className="text-sm font-black text-foreground">{selected.size} selected</span>
          <button
            type="button"
            onClick={clearSelection}
            className="text-xs font-bold text-muted-foreground underline hover:no-underline"
          >
            Clear
          </button>
          <div className="flex-1" />
          <button
            type="button"
            disabled={bulkBusy}
            onClick={() => setPendingAction("freeze")}
            className="inline-flex items-center gap-1.5 rounded-xl border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-bold text-blue-700 hover:bg-blue-100 transition-colors disabled:opacity-50"
          >
            <Snowflake className="h-3.5 w-3.5" /> Freeze
          </button>
          <button
            type="button"
            disabled={bulkBusy}
            onClick={() => setPendingAction("unfreeze")}
            className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-card px-3 py-1.5 text-xs font-bold text-foreground hover:bg-surface-2 transition-colors disabled:opacity-50"
          >
            <Snowflake className="h-3.5 w-3.5" /> Unfreeze
          </button>
          <button
            type="button"
            disabled={bulkBusy}
            onClick={() => setPendingAction("delete")}
            className="inline-flex items-center gap-1.5 rounded-xl border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-bold text-red-700 hover:bg-red-100 transition-colors disabled:opacity-50"
          >
            <Trash2 className="h-3.5 w-3.5" /> Delete
          </button>
        </div>
      )}

      {/* Table */}
      <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
        <div className="border-b border-border px-5 py-4 flex items-center justify-between gap-2">
          <p className="font-bold text-foreground text-sm">
            {loading
              ? "Loading…"
              : `${filtered.length} user${filtered.length === 1 ? "" : "s"}`}
          </p>
          {!loading && filtered.length !== users.length && (
            <p className="text-xs text-muted-foreground">{users.length} total</p>
          )}
        </div>

        {loading ? (
          <div className="flex justify-center p-10">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
          </div>
        ) : paginated.length === 0 ? (
          <div className="p-8 text-center text-muted-foreground">
            <Users className="h-8 w-8 mx-auto mb-3 opacity-30" />
            <p className="font-semibold">
              {users.length === 0 ? "No users found." : "No users match your filters."}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="w-10 px-3 py-3">
                    <input
                      type="checkbox"
                      aria-label="Select all on this page"
                      checked={allOnPageSelected}
                      onChange={toggleAllOnPage}
                      className="h-4 w-4 rounded accent-primary cursor-pointer"
                    />
                  </th>
                  <th className="text-left px-5 py-3 text-[10px] font-bold text-muted-foreground uppercase tracking-widest">
                    User
                  </th>
                  <th className="text-left px-4 py-3 text-[10px] font-bold text-muted-foreground uppercase tracking-widest whitespace-nowrap hidden sm:table-cell">
                    Role
                  </th>
                  <th className="text-left px-4 py-3 text-[10px] font-bold text-muted-foreground uppercase tracking-widest whitespace-nowrap hidden md:table-cell">
                    Subject
                  </th>
                  <th className="text-left px-4 py-3 text-[10px] font-bold text-muted-foreground uppercase tracking-widest whitespace-nowrap hidden lg:table-cell">
                    Joined
                  </th>
                  <th className="text-left px-4 py-3 text-[10px] font-bold text-muted-foreground uppercase tracking-widest whitespace-nowrap">
                    Status
                  </th>
                  <th className="text-left px-4 py-3 text-[10px] font-bold text-muted-foreground uppercase tracking-widest whitespace-nowrap">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {paginated.map((u) => {
                  const fullName = [u.first_name, u.last_name].filter(Boolean).join(" ");
                  const roleColor = ROLE_COLORS[u.role] ?? "bg-slate-100 text-slate-700";
                  const roleLabel = ROLE_LABELS[u.role] ?? u.role;
                  const isSelected = selected.has(u.id);
                  return (
                    <tr
                      key={u.id}
                      className={cn(
                        "transition-colors cursor-pointer",
                        isSelected ? "bg-primary/5" : "hover:bg-surface-2/50",
                      )}
                      onClick={() => setEditing(u)}
                    >
                      <td className="w-10 px-3 py-3" onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          aria-label={`Select ${u.email}`}
                          checked={isSelected}
                          onChange={() => toggleOne(u.id)}
                          className="h-4 w-4 rounded accent-primary cursor-pointer"
                        />
                      </td>
                      <td className="px-5 py-3">
                        <p className="font-bold text-foreground">
                          {fullName || u.username || u.email}
                        </p>
                        <p className="text-xs text-muted-foreground">{u.email}</p>
                        {fullName && u.username && (
                          <p className="text-xs text-muted-foreground font-mono">{u.username}</p>
                        )}
                        {/* The two signals that actually separate duplicate registrations.
                            Verification cannot: nothing was ever recorded, so every
                            pre-existing account reads unverified. */}
                        <p className="text-xs text-muted-foreground">
                          {(u.attempt_count ?? 0) === 1 ? "1 exam" : `${u.attempt_count ?? 0} exams`}
                          {" · "}
                          {u.last_login ? `seen ${formatDate(u.last_login)}` : "never signed in"}
                        </p>
                        <div className="mt-1 sm:hidden">
                          <span className={cn("inline-flex items-center rounded-lg px-2 py-0.5 text-[10px] font-black uppercase tracking-wide", roleColor)}>
                            {roleLabel}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap hidden sm:table-cell">
                        <span className={cn("inline-flex items-center rounded-lg px-2 py-0.5 text-[10px] font-black uppercase tracking-wide", roleColor)}>
                          {roleLabel}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm text-muted-foreground hidden md:table-cell">
                        {u.subject ?? "—"}
                      </td>
                      <td className="px-4 py-3 text-sm text-muted-foreground hidden lg:table-cell whitespace-nowrap">
                        {formatDate(u.date_joined)}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <div className="flex flex-col gap-1">
                          {u.is_frozen ? (
                            <span className="inline-flex items-center gap-1 text-xs font-bold text-blue-600">
                              <Snowflake className="h-3.5 w-3.5" /> Frozen
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-xs font-bold text-emerald-700">
                              <UserCheck className="h-3.5 w-3.5" /> Active
                            </span>
                          )}
                          {u.email_verified ? (
                            <span className="inline-flex items-center gap-1 text-xs font-bold text-emerald-700">
                              <MailCheck className="h-3.5 w-3.5" /> Email verified
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-xs font-semibold text-muted-foreground">
                              <MailQuestion className="h-3.5 w-3.5" /> Email unverified
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => setEditing(u)}
                            className="rounded-lg border border-border bg-card px-2.5 py-1.5 text-xs font-bold text-foreground hover:bg-surface-2 transition-colors"
                          >
                            Edit
                          </button>
                          {u.is_frozen ? (
                            <button
                              type="button"
                              title="Unfreeze account"
                              onClick={() => void setFrozenSingle(u, false)}
                              className="rounded-lg border border-blue-200 bg-blue-50 px-2.5 py-1.5 text-xs font-bold text-blue-700 hover:bg-blue-100 transition-colors"
                            >
                              <Snowflake className="h-3.5 w-3.5" />
                            </button>
                          ) : (
                            <button
                              type="button"
                              title="Freeze account"
                              onClick={() => void setFrozenSingle(u, true)}
                              className="rounded-lg border border-border bg-card px-2.5 py-1.5 text-xs font-bold text-muted-foreground hover:bg-surface-2 transition-colors"
                            >
                              <ShieldAlert className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination */}
        {!loading && totalPages > 1 && (
          <div className="border-t border-border px-5 py-3 flex items-center justify-between gap-2">
            <button
              type="button"
              disabled={page === 1}
              onClick={() => setPage((p) => p - 1)}
              className="rounded-xl border border-border px-3 py-1.5 text-xs font-bold text-foreground disabled:opacity-40 hover:bg-surface-2 transition-colors"
            >
              ← Previous
            </button>
            <p className="text-xs text-muted-foreground">
              Page {page} of {totalPages}
            </p>
            <button
              type="button"
              disabled={page === totalPages}
              onClick={() => setPage((p) => p + 1)}
              className="rounded-xl border border-border px-3 py-1.5 text-xs font-bold text-foreground disabled:opacity-40 hover:bg-surface-2 transition-colors"
            >
              Next →
            </button>
          </div>
        )}
      </div>

      {/* Edit modal */}
      {editing && (
        <EditUserModal
          user={editing}
          onClose={() => setEditing(null)}
          onSaved={handleSaved}
        />
      )}

      {/* Bulk confirmation */}
      {pendingAction && (
        <ConfirmBulkModal
          action={pendingAction}
          count={selected.size}
          attemptTotal={users.reduce(
            (sum, u) => (selected.has(u.id) ? sum + (u.attempt_count ?? 0) : sum),
            0,
          )}
          busy={bulkBusy}
          onCancel={() => (bulkBusy ? undefined : setPendingAction(null))}
          onConfirm={() => void runBulk(pendingAction)}
        />
      )}
    </div>
  );
}
