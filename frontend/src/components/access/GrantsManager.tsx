"use client";

import { useCallback, useEffect, useState } from "react";
import { Clock, History, Loader2, RefreshCw, Search, ShieldX, X } from "lucide-react";
import {
  accessApi,
  resourceTypeLabel,
  type GrantEvent,
  type GrantFilters,
  type ResourceAccessGrant,
} from "@/lib/accessApi";
import { cn } from "@/lib/cn";

const STATUS_STYLES: Record<string, string> = {
  ACTIVE: "bg-emerald-50 text-emerald-700 border-emerald-200",
  REVOKED: "bg-red-50 text-red-700 border-red-200",
  EXPIRED: "bg-amber-50 text-amber-700 border-amber-200",
};

function targetLabel(g: ResourceAccessGrant): string {
  if (g.scope === "SUBJECT") return `Subject · ${g.subject}`;
  return g.resource_label || `${resourceTypeLabel(g.resource_type ?? "")} #${g.resource_id}`;
}

export function GrantsManager({ refreshKey = 0 }: { refreshKey?: number }) {
  const [grants, setGrants] = useState<ResourceAccessGrant[]>([]);
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<GrantFilters>({ status: "ACTIVE" });
  const [auditFor, setAuditFor] = useState<ResourceAccessGrant | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await accessApi.listGrants(filters);
      setGrants(res.results);
      setCount(res.count);
    } catch (e: unknown) {
      const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(typeof detail === "string" ? detail : "Could not load grants.");
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  const revoke = async (g: ResourceAccessGrant) => {
    if (!confirm(`Revoke access for ${g.user_email}?`)) return;
    setBusyId(g.id);
    try {
      await accessApi.revoke(g.id);
      await load();
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
      await load();
    } finally {
      setBusyId(null);
    }
  };

  const setFilter = (patch: Partial<GrantFilters>) => setFilters((f) => ({ ...f, ...patch }));

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-border bg-card p-3">
        <div className="relative min-w-[200px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={filters.q ?? ""}
            onChange={(e) => setFilter({ q: e.target.value })}
            placeholder="Search by student name or email…"
            className="w-full rounded-xl border border-border bg-card py-2 pl-9 pr-3 text-sm text-foreground outline-none focus:ring-2 focus:ring-primary/40"
          />
        </div>
        <FilterSelect value={filters.scope ?? ""} onChange={(v) => setFilter({ scope: v as GrantFilters["scope"] })} options={[["", "All scopes"], ["SUBJECT", "Subject"], ["RESOURCE", "Resource"]]} />
        <FilterSelect value={filters.status ?? ""} onChange={(v) => setFilter({ status: v as GrantFilters["status"] })} options={[["", "All statuses"], ["ACTIVE", "Active"], ["REVOKED", "Revoked"], ["EXPIRED", "Expired"]]} />
        <FilterSelect value={filters.source ?? ""} onChange={(v) => setFilter({ source: v as GrantFilters["source"] })} options={[["", "All sources"], ["MANUAL", "Manual"], ["BULK", "Bulk"], ["CLASSROOM", "Classroom"], ["PURCHASE", "Purchase"], ["SYSTEM", "System"]]} />
        <button
          type="button"
          onClick={() => void load()}
          className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-card px-3 py-2 text-xs font-bold text-foreground hover:bg-surface-2"
        >
          <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} /> Refresh
        </button>
      </div>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-700">{error}</div>
      )}

      {/* Table */}
      <div className="overflow-x-auto rounded-2xl border border-border bg-card">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs font-bold uppercase tracking-wide text-muted-foreground">
              <th className="px-4 py-3">Student</th>
              <th className="px-4 py-3">Target</th>
              <th className="px-4 py-3">Source</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Expires</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-muted-foreground"><Loader2 className="mx-auto h-5 w-5 animate-spin" /></td></tr>
            ) : grants.length === 0 ? (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-sm text-muted-foreground">No grants match these filters.</td></tr>
            ) : (
              grants.map((g) => (
                <tr key={g.id} className="border-b border-border last:border-b-0 hover:bg-surface-2/50">
                  <td className="px-4 py-3">
                    <div className="font-bold text-foreground">{g.user_name}</div>
                    <div className="text-xs text-muted-foreground">{g.user_email}</div>
                  </td>
                  <td className="px-4 py-3 text-foreground">
                    {targetLabel(g)}
                    {g.classroom_name && <div className="text-xs text-muted-foreground">via {g.classroom_name}</div>}
                  </td>
                  <td className="px-4 py-3"><span className="text-xs font-semibold text-muted-foreground">{g.source}</span></td>
                  <td className="px-4 py-3">
                    <span className={cn("inline-block rounded-md border px-2 py-0.5 text-xs font-bold", STATUS_STYLES[g.status])}>
                      {g.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">
                    {g.expires_at ? new Date(g.expires_at).toLocaleDateString() : "—"}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      <IconBtn title="History" onClick={() => setAuditFor(g)} icon={History} />
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
      <p className="text-xs text-muted-foreground">{count} grant(s) total{count > grants.length ? ` · showing ${grants.length}` : ""}</p>

      {auditFor && <AuditDrawer grant={auditFor} onClose={() => setAuditFor(null)} />}
    </div>
  );
}

function FilterSelect({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: [string, string][];
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="rounded-xl border border-border bg-card px-3 py-2 text-xs font-semibold text-foreground outline-none focus:ring-2 focus:ring-primary/40"
    >
      {options.map(([v, l]) => (
        <option key={v} value={v}>{l}</option>
      ))}
    </select>
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

function AuditDrawer({ grant, onClose }: { grant: ResourceAccessGrant; onClose: () => void }) {
  const [events, setEvents] = useState<GrantEvent[] | null>(null);
  useEffect(() => {
    (async () => setEvents(await accessApi.events(grant.id)))();
  }, [grant.id]);
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/30" onClick={onClose}>
      <div
        className="h-full w-full max-w-md overflow-y-auto border-l border-border bg-card p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-primary">Audit trail</p>
            <h3 className="text-lg font-extrabold text-foreground">Grant #{grant.id}</h3>
            <p className="text-sm text-muted-foreground">{grant.user_email} · {targetLabel(grant)}</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-1 hover:bg-surface-2"><X className="h-5 w-5" /></button>
        </div>
        {events === null ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>
        ) : events.length === 0 ? (
          <p className="text-sm text-muted-foreground">No events recorded.</p>
        ) : (
          <ol className="space-y-3">
            {events.map((ev) => (
              <li key={ev.id} className="rounded-xl border border-border p-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-bold text-foreground">{ev.action}</span>
                  <span className="text-xs text-muted-foreground">{new Date(ev.created_at).toLocaleString()}</span>
                </div>
                {ev.actor_email && <p className="text-xs text-muted-foreground">by {ev.actor_email}</p>}
                {ev.note && <p className="mt-1 text-xs italic text-muted-foreground">{ev.note}</p>}
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}
