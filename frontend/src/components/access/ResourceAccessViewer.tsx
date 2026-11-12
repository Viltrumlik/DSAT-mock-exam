"use client";

import { useCallback, useEffect, useState } from "react";

import { Icon } from "@/components/ui/Icon";
import { LibraryError } from "@/features/builderLibrary/sectionParts";
import { Button, EmptyState } from "@/features/console/ui";
import { accessApi, type ResourceAccessGrant } from "@/lib/accessApi";
import { cn } from "@/lib/cn";
import { GrantPanel } from "./GrantPanel";
import { ResourcePicker, type SelectedResource } from "./ResourcePicker";
import {
  AccessAvatar,
  CARD,
  EYEBROW,
  GrantStatus,
  LoadingRows,
  RowAction,
  TABLE,
  TABLE_CARD,
  TD,
  TH,
  TH_R,
  TR,
} from "./accessConsole";

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
    <div className="flex flex-col gap-4">
      {/* Resource picker (single) */}
      <div className={cn(CARD, "p-4")}>
        <p className={cn(EYEBROW, "mb-2")}>
          <Icon name="bookmark" size="sm" /> Pick a test / resource
        </p>
        <ResourcePicker value={picked} onChange={setPicked} single />
      </div>

      {active && (
        <div className="flex flex-col gap-4">
          {/* Active resource header */}
          <div className={cn(CARD, "flex flex-wrap items-center justify-between gap-3 p-4")}>
            <div className="flex min-w-0 flex-1 basis-[18rem] items-center gap-3">
              <span className="grid size-10 shrink-0 place-items-center rounded-ms-ctl bg-ms-primary-soft text-ms-primary-text">
                <Icon name="bookmark" />
              </span>
              <div className="min-w-0">
                <div className="truncate text-[16px] font-bold text-ms-fg">{active.label}</div>
                <div className="text-[13px] text-ms-fg-3">
                  {grants.length} user{grants.length === 1 ? "" : "s"} with active access
                </div>
              </div>
            </div>
            <Button variant="primary" icon="plus" onClick={() => setAdding((v) => !v)}>
              Add users
            </Button>
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

          {error && <LibraryError>{error}</LibraryError>}

          {/* Users table */}
          <div className={TABLE_CARD}>
            <div className="overflow-x-auto">
              <table className={TABLE}>
                <thead>
                  <tr>
                    <th scope="col" className={TH}>User</th>
                    <th scope="col" className={TH}>Source</th>
                    <th scope="col" className={TH}>Status</th>
                    <th scope="col" className={TH}>Expires</th>
                    <th scope="col" className={TH_R}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <LoadingRows cols={5} />
                  ) : grants.length === 0 ? (
                    <tr>
                      <td colSpan={5}>
                        <EmptyState icon="users" title="No one has access yet. Use “Add users”." />
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
                        <td className={cn(TD, "text-[13px] font-medium text-ms-fg-3")}>{g.source}</td>
                        <td className={TD}>
                          <GrantStatus status={g.status} />
                        </td>
                        <td className={cn(TD, "whitespace-nowrap text-[13px] text-ms-fg-3")}>
                          {g.expires_at ? new Date(g.expires_at).toLocaleDateString() : "—"}
                        </td>
                        <td className={TD}>
                          <div className="flex items-center justify-end">
                            <RowAction title="Revoke" danger onClick={() => void revoke(g)} icon="shield" busy={busyId === g.id} />
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
