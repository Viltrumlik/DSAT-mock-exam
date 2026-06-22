"use client";

import { useCallback, useEffect, useState } from "react";
import { BookMarked, Loader2, Plus, ShieldX, Users } from "lucide-react";
import { accessApi, type ResourceAccessGrant } from "@/lib/accessApi";
import { cn } from "@/lib/cn";
import { GrantPanel } from "./GrantPanel";
import { ResourcePicker, type SelectedResource } from "./ResourcePicker";

const STATUS_STYLES: Record<string, string> = {
  ACTIVE: "bg-emerald-50 text-emerald-700 border-emerald-200",
  REVOKED: "bg-red-50 text-red-700 border-red-200",
  EXPIRED: "bg-amber-50 text-amber-700 border-amber-200",
};

/** By resource: pick one resource, see who can access it and grant/revoke. */
export function ResourceAccessViewer({ onChanged }: { onChanged?: () => void }) {
  const [picked, setPicked] = useState<SelectedResource[]>([]);
  const active = picked[0] ?? null;

  const [grants, setGrants] = useState<ResourceAccessGrant[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);

  const loadGrants = useCallback(async () => {
    if (!active) {
      setGrants([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await accessApi.listGrants({
        resource_type: active.resource_type,
        resource_id: active.resource_id,
        status: "ACTIVE",
        page_size: 200,
      });
      setGrants(res.results);
    } catch (e: unknown) {
      const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(typeof detail === "string" ? detail : "Could not load access for this resource.");
    } finally {
      setLoading(false);
    }
  }, [active]);

  useEffect(() => {
    void loadGrants();
  }, [loadGrants]);

  const revoke = async (g: ResourceAccessGrant) => {
    if (!confirm(`Revoke access for ${g.user_email}?`)) return;
    setBusyId(g.id);
    try {
      await accessApi.revoke(g.id);
      await loadGrants();
      onChanged?.();
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-4">
      {/* Resource picker (single) */}
      <div className="rounded-2xl border border-border bg-card p-3">
        <label className="mb-1.5 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-muted-foreground">
          <BookMarked className="h-3.5 w-3.5" /> Pick a test / resource
        </label>
        <ResourcePicker value={picked} onChange={setPicked} single />
      </div>

      {active && (
        <div className="space-y-4">
          {/* Active resource header */}
          <div className="flex items-center justify-between rounded-2xl border border-border bg-card p-4">
            <div className="flex items-center gap-3">
              <span className="rounded-xl bg-surface-2 p-2.5 text-primary">
                <BookMarked className="h-5 w-5" />
              </span>
              <div>
                <div className="text-base font-extrabold text-foreground">{active.label}</div>
                <div className="text-xs text-muted-foreground">
                  {grants.length} user{grants.length === 1 ? "" : "s"} with active access
                </div>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setAdding((v) => !v)}
              className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2 text-sm font-bold text-primary-foreground hover:opacity-90"
            >
              <Plus className="h-4 w-4" /> Add users
            </button>
          </div>

          {adding && (
            <GrantPanel
              key={`${active.resource_type}:${active.resource_id}`}
              lockResource={active}
              onSuccess={() => {
                void loadGrants();
                onChanged?.();
              }}
            />
          )}

          {error && (
            <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-700">{error}</div>
          )}

          {/* Users table */}
          <div className="overflow-x-auto rounded-2xl border border-border bg-card">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs font-bold uppercase tracking-wide text-muted-foreground">
                  <th className="px-4 py-3">User</th>
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
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-sm text-muted-foreground">
                      <Users className="mx-auto mb-2 h-5 w-5 opacity-50" />
                      No one has access yet. Use “Add users”.
                    </td>
                  </tr>
                ) : (
                  grants.map((g) => (
                    <tr key={g.id} className="border-b border-border last:border-b-0 hover:bg-surface-2/50">
                      <td className="px-4 py-3">
                        <div className="font-bold text-foreground">{g.user_name}</div>
                        <div className="text-xs text-muted-foreground">{g.user_email}</div>
                      </td>
                      <td className="px-4 py-3"><span className="text-xs font-semibold text-muted-foreground">{g.source}</span></td>
                      <td className="px-4 py-3">
                        <span className={cn("inline-block rounded-md border px-2 py-0.5 text-xs font-bold", STATUS_STYLES[g.status])}>{g.status}</span>
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">
                        {g.expires_at ? new Date(g.expires_at).toLocaleDateString() : "—"}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end">
                          <button
                            type="button"
                            title="Revoke"
                            onClick={() => void revoke(g)}
                            disabled={busyId === g.id}
                            className="rounded-lg border border-border p-1.5 text-red-600 transition-colors hover:bg-red-50 disabled:opacity-50"
                          >
                            {busyId === g.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldX className="h-4 w-4" />}
                          </button>
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
