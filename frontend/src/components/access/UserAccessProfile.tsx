"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Clock, Loader2, Plus, Search, ShieldX, UserCheck } from "lucide-react";
import api from "@/lib/api";
import { accessApi, type ResourceAccessGrant } from "@/lib/accessApi";
import { cn } from "@/lib/cn";
import { GrantPanel } from "./GrantPanel";

type UserRow = {
  id: number;
  email?: string;
  username?: string;
  first_name?: string;
  last_name?: string;
  role?: string;
};

const STATUS_STYLES: Record<string, string> = {
  ACTIVE: "bg-emerald-50 text-emerald-700 border-emerald-200",
  REVOKED: "bg-red-50 text-red-700 border-red-200",
  EXPIRED: "bg-amber-50 text-amber-700 border-amber-200",
};

function userLabel(u: UserRow): string {
  const name = `${u.first_name ?? ""} ${u.last_name ?? ""}`.trim();
  return name || u.email || u.username || `User #${u.id}`;
}

function grantTarget(g: ResourceAccessGrant): string {
  if (g.scope === "SUBJECT") return `Subject · ${g.subject}`;
  return g.resource_label || `${g.resource_type} #${g.resource_id}`;
}

/** By user: pick one user, see and edit everything they can access. */
export function UserAccessProfile({ onChanged }: { onChanged?: () => void }) {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [search, setSearch] = useState("");
  const [active, setActive] = useState<UserRow | null>(null);

  const [grants, setGrants] = useState<ResourceAccessGrant[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [granting, setGranting] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const r = await api.get("/users/");
        const raw: UserRow[] = Array.isArray(r.data) ? r.data : (r.data?.results ?? []);
        setUsers(raw);
      } catch {
        /* non-fatal */
      }
    })();
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return users.slice(0, 30);
    return users
      .filter(
        (u) =>
          userLabel(u).toLowerCase().includes(q) ||
          (u.email ?? "").toLowerCase().includes(q) ||
          (u.username ?? "").toLowerCase().includes(q),
      )
      .slice(0, 30);
  }, [users, search]);

  const loadGrants = useCallback(async () => {
    if (!active) return;
    setLoading(true);
    setError(null);
    try {
      const res = await accessApi.listGrants({ user: active.id, page_size: 200 });
      setGrants(res.results);
    } catch (e: unknown) {
      const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(typeof detail === "string" ? detail : "Could not load this user's access.");
    } finally {
      setLoading(false);
    }
  }, [active]);

  useEffect(() => {
    void loadGrants();
  }, [loadGrants]);

  const revoke = async (g: ResourceAccessGrant) => {
    if (!confirm(`Revoke "${grantTarget(g)}" for ${g.user_email}?`)) return;
    setBusyId(g.id);
    try {
      await accessApi.revoke(g.id);
      await loadGrants();
      onChanged?.();
    } finally {
      setBusyId(null);
    }
  };

  const extend = async (g: ResourceAccessGrant) => {
    const input = prompt("New expiry (YYYY-MM-DD, or empty to clear):", "");
    if (input === null) return;
    const iso = input.trim() ? new Date(input.trim()).toISOString() : null;
    setBusyId(g.id);
    try {
      await accessApi.extend(g.id, iso);
      await loadGrants();
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-4">
      {/* User picker */}
      <div className="rounded-2xl border border-border bg-card p-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search a user by name, username, or email…"
            className="w-full rounded-xl border border-border bg-card py-2 pl-9 pr-3 text-sm text-foreground outline-none focus:ring-2 focus:ring-primary/40"
          />
        </div>
        {!active && (
          <div className="mt-2 max-h-56 overflow-y-auto rounded-xl border border-border">
            {filtered.length === 0 ? (
              <p className="p-4 text-sm text-muted-foreground">No users match.</p>
            ) : (
              filtered.map((u) => (
                <button
                  key={u.id}
                  type="button"
                  onClick={() => setActive(u)}
                  className="flex w-full items-center justify-between gap-2 border-b border-border px-3 py-2 text-left text-sm last:border-b-0 hover:bg-surface-2"
                >
                  <span className="min-w-0 truncate">
                    <span className="font-bold text-foreground">{userLabel(u)}</span>
                    {u.email && <span className="ml-2 text-xs text-muted-foreground">{u.email}</span>}
                  </span>
                  {u.role && (
                    <span className="shrink-0 text-[10px] font-bold uppercase text-muted-foreground">{u.role}</span>
                  )}
                </button>
              ))
            )}
          </div>
        )}
      </div>

      {active && (
        <div className="space-y-4">
          {/* Active user header */}
          <div className="flex items-center justify-between rounded-2xl border border-border bg-card p-4">
            <div className="flex items-center gap-3">
              <span className="rounded-xl bg-surface-2 p-2.5 text-primary">
                <UserCheck className="h-5 w-5" />
              </span>
              <div>
                <div className="text-base font-extrabold text-foreground">{userLabel(active)}</div>
                <div className="text-xs text-muted-foreground">{active.email}</div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setGranting((v) => !v)}
                className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2 text-sm font-bold text-primary-foreground hover:opacity-90"
              >
                <Plus className="h-4 w-4" /> Grant access
              </button>
              <button
                type="button"
                onClick={() => {
                  setActive(null);
                  setGranting(false);
                  setGrants([]);
                }}
                className="rounded-xl border border-border bg-card px-4 py-2 text-sm font-bold text-foreground hover:bg-surface-2"
              >
                Change user
              </button>
            </div>
          </div>

          {granting && (
            <GrantPanel
              key={active.id}
              lockUserIds={[active.id]}
              onSuccess={() => {
                void loadGrants();
                onChanged?.();
              }}
            />
          )}

          {error && (
            <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-700">{error}</div>
          )}

          {/* Grants table */}
          <div className="overflow-x-auto rounded-2xl border border-border bg-card">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs font-bold uppercase tracking-wide text-muted-foreground">
                  <th className="px-4 py-3">Access to</th>
                  <th className="px-4 py-3">Source</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Expires</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={5} className="px-4 py-8 text-center"><Loader2 className="mx-auto h-5 w-5 animate-spin text-muted-foreground" /></td></tr>
                ) : grants.length === 0 ? (
                  <tr><td colSpan={5} className="px-4 py-8 text-center text-sm text-muted-foreground">No access grants yet. Use “Grant access” to add some.</td></tr>
                ) : (
                  grants.map((g) => (
                    <tr key={g.id} className="border-b border-border last:border-b-0 hover:bg-surface-2/50">
                      <td className="px-4 py-3 text-foreground">
                        {grantTarget(g)}
                        {g.classroom_name && <div className="text-xs text-muted-foreground">via {g.classroom_name}</div>}
                      </td>
                      <td className="px-4 py-3"><span className="text-xs font-semibold text-muted-foreground">{g.source}</span></td>
                      <td className="px-4 py-3">
                        <span className={cn("inline-block rounded-md border px-2 py-0.5 text-xs font-bold", STATUS_STYLES[g.status])}>{g.status}</span>
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">
                        {g.expires_at ? new Date(g.expires_at).toLocaleDateString() : "—"}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-1">
                          <IconBtn title="Extend / set expiry" onClick={() => void extend(g)} icon={Clock} busy={busyId === g.id} />
                          {g.status === "ACTIVE" && (
                            <IconBtn title="Revoke" danger onClick={() => void revoke(g)} icon={ShieldX} busy={busyId === g.id} />
                          )}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function IconBtn({
  title,
  onClick,
  icon: Icon,
  danger,
  busy,
}: {
  title: string;
  onClick: () => void;
  icon: React.ElementType;
  danger?: boolean;
  busy?: boolean;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      disabled={busy}
      className={cn(
        "rounded-lg border border-border p-1.5 transition-colors hover:bg-surface-2 disabled:opacity-50",
        danger ? "text-red-600 hover:bg-red-50" : "text-foreground",
      )}
    >
      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Icon className="h-4 w-4" />}
    </button>
  );
}
