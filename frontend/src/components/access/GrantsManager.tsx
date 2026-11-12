"use client";

import { useCallback, useEffect, useState } from "react";

import { Icon } from "@/components/ui/Icon";
import { LibraryError } from "@/features/builderLibrary/sectionParts";
import { EmptyState, Sheet, buttonClass } from "@/features/console/ui";
import { CONTROL } from "@/features/questionsAdmin/questionLook";
import {
  accessApi,
  resourceTypeLabel,
  type GrantEvent,
  type GrantFilters,
  type ResourceAccessGrant,
} from "@/lib/accessApi";
import { cn } from "@/lib/cn";
import {
  AccessAvatar,
  CARD,
  GrantStatus,
  LoadingRows,
  RowAction,
  SearchInput,
  TABLE,
  TABLE_CARD,
  TD,
  TH,
  TH_R,
  TR,
} from "./accessConsole";

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
    <div className="flex flex-col gap-4">
      {/* Filters */}
      <div className={cn(CARD, "flex flex-wrap items-center gap-2 p-3")}>
        <div className="min-w-0 flex-1 basis-[18rem]">
          <SearchInput
            value={filters.q ?? ""}
            onChange={(q) => setFilter({ q })}
            placeholder="Search by student name or email…"
          />
        </div>
        <FilterSelect value={filters.scope ?? ""} onChange={(v) => setFilter({ scope: v as GrantFilters["scope"] })} options={[["", "All scopes"], ["SUBJECT", "Subject"], ["RESOURCE", "Resource"]]} />
        <FilterSelect value={filters.status ?? ""} onChange={(v) => setFilter({ status: v as GrantFilters["status"] })} options={[["", "All statuses"], ["ACTIVE", "Active"], ["REVOKED", "Revoked"], ["EXPIRED", "Expired"]]} />
        <FilterSelect value={filters.source ?? ""} onChange={(v) => setFilter({ source: v as GrantFilters["source"] })} options={[["", "All sources"], ["MANUAL", "Manual"], ["BULK", "Bulk"], ["CLASSROOM", "Classroom"], ["PURCHASE", "Purchase"], ["SYSTEM", "System"]]} />
        <button type="button" onClick={() => void load()} className={buttonClass({ variant: "secondary" })}>
          <Icon name="refresh" className={loading ? "animate-ms-spin" : undefined} /> Refresh
        </button>
      </div>

      {error && <LibraryError>{error}</LibraryError>}

      {/* Table */}
      <div className={TABLE_CARD}>
        <div className="overflow-x-auto">
          <table className={TABLE}>
            <thead>
              <tr>
                <th scope="col" className={TH}>Student</th>
                <th scope="col" className={TH}>Target</th>
                <th scope="col" className={TH}>Source</th>
                <th scope="col" className={TH}>Status</th>
                <th scope="col" className={TH}>Expires</th>
                <th scope="col" className={TH_R}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <LoadingRows cols={6} />
              ) : grants.length === 0 ? (
                <tr>
                  <td colSpan={6}>
                    <EmptyState icon="search" title="No grants match these filters." />
                  </td>
                </tr>
              ) : (
                grants.map((g) => (
                  <tr key={g.id} className={TR}>
                    <td className={TD}>
                      <div className="flex items-center gap-2.5">
                        <AccessAvatar name={g.user_name || g.user_email || `#${g.id}`} seed={g.user_email || g.id} size="sm" src={g.user_profile_image_url} />
                        <div className="min-w-0">
                          <div className="truncate font-semibold text-ms-fg">{g.user_name}</div>
                          <div className="truncate text-[13px] text-ms-fg-3">{g.user_email}</div>
                        </div>
                      </div>
                    </td>
                    <td className={TD}>
                      {targetLabel(g)}
                      {g.classroom_name && <div className="text-[13px] text-ms-fg-3">via {g.classroom_name}</div>}
                    </td>
                    <td className={cn(TD, "text-[13px] font-medium text-ms-fg-3")}>{g.source}</td>
                    <td className={TD}>
                      <GrantStatus status={g.status} />
                    </td>
                    <td className={cn(TD, "whitespace-nowrap text-[13px] text-ms-fg-3")}>
                      {g.expires_at ? new Date(g.expires_at).toLocaleDateString() : "—"}
                    </td>
                    <td className={TD}>
                      <div className="flex items-center justify-end gap-1">
                        <RowAction title="History" onClick={() => setAuditFor(g)} icon="history" />
                        <RowAction title="Extend / set expiry" onClick={() => void extend(g)} icon="clock" busy={busyId === g.id} />
                        {g.status === "ACTIVE" && (
                          <RowAction title="Revoke" danger onClick={() => void revoke(g)} icon="shield" busy={busyId === g.id} />
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
      <p className="text-[13px] text-ms-fg-3">{count} grant(s) total{count > grants.length ? ` · showing ${grants.length}` : ""}</p>

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
  // CONTROL is full width: the wrapper sets the width (a whole row on a phone).
  return (
    <div className="w-full sm:w-44">
      <select value={value} onChange={(e) => onChange(e.target.value)} className={CONTROL}>
        {options.map(([v, l]) => (
          <option key={v} value={v}>{l}</option>
        ))}
      </select>
    </div>
  );
}

function AuditDrawer({ grant, onClose }: { grant: ResourceAccessGrant; onClose: () => void }) {
  const [events, setEvents] = useState<GrantEvent[] | null>(null);
  useEffect(() => {
    (async () => setEvents(await accessApi.events(grant.id)))();
  }, [grant.id]);
  return (
    <Sheet
      open
      onClose={onClose}
      title={
        <>
          <span className="text-ms-over mb-0.5 block text-ms-primary-text">Audit trail</span>
          Grant #{grant.id}
        </>
      }
    >
      <p className="mb-4 text-[14px] text-ms-fg-2">{grant.user_email} · {targetLabel(grant)}</p>
      {events === null ? (
        <div role="status" className="flex items-center gap-2 text-[14px] text-ms-fg-3">
          <Icon name="loader" size="sm" className="animate-ms-spin" /> Loading…
        </div>
      ) : events.length === 0 ? (
        <p className="text-[14px] text-ms-fg-3">No events recorded.</p>
      ) : (
        <ol className="flex flex-col gap-3">
          {events.map((ev) => (
            <li key={ev.id} className="rounded-ms-ctl border border-ms-border p-3">
              <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5">
                <span className="text-[14px] font-semibold text-ms-fg">{ev.action}</span>
                <span className="text-[13px] text-ms-fg-3">{new Date(ev.created_at).toLocaleString()}</span>
              </div>
              {ev.actor_email && <p className="text-[13px] text-ms-fg-3">by {ev.actor_email}</p>}
              {ev.note && <p className="mt-1 text-[13px] italic text-ms-fg-3">{ev.note}</p>}
            </li>
          ))}
        </ol>
      )}
    </Sheet>
  );
}
