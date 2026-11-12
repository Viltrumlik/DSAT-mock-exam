"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { LibraryError } from "@/features/builderLibrary/sectionParts";
import { Badge, Button, EmptyState } from "@/features/console/ui";
import api from "@/lib/api";
import { accessApi, type ResourceAccessGrant } from "@/lib/accessApi";
import { cn } from "@/lib/cn";
import { GrantPanel } from "./GrantPanel";
import {
  AccessAvatar,
  CARD,
  GrantStatus,
  LoadingRows,
  ROW,
  ROW_OFF,
  RowAction,
  SearchInput,
  TABLE,
  TABLE_CARD,
  TD,
  TH,
  TH_R,
  TR,
} from "./accessConsole";

type UserRow = {
  id: number;
  email?: string;
  username?: string;
  first_name?: string;
  last_name?: string;
  role?: string;
  /** Absolute URL of the profile photo; null when the account has not uploaded one. */
  profile_image_url?: string | null;
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
    <div className="flex flex-col gap-4">
      {/* User picker */}
      <div className={cn(CARD, "p-3")}>
        <SearchInput value={search} onChange={setSearch} placeholder="Search a user by name, username, or email…" />
        {!active && (
          <div className="mt-2 flex max-h-[360px] flex-col gap-2 overflow-y-auto">
            {filtered.length === 0 ? (
              <EmptyState icon="users" title="No users match." />
            ) : (
              filtered.map((u) => (
                <button
                  key={u.id}
                  type="button"
                  onClick={() => setActive(u)}
                  className={cn(ROW, ROW_OFF)}
                >
                  <AccessAvatar name={userLabel(u)} seed={u.id} size="md" src={u.profile_image_url} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14px] font-semibold text-ms-fg">{userLabel(u)}</span>
                    {u.email && <span className="block truncate text-[13px] text-ms-fg-3">{u.email}</span>}
                  </span>
                  {u.role && <Badge tone="neutral">{u.role}</Badge>}
                </button>
              ))
            )}
          </div>
        )}
      </div>

      {active && (
        <div className="flex flex-col gap-4">
          {/* Active user header */}
          <div className={cn(CARD, "flex flex-wrap items-center justify-between gap-3 p-4")}>
            <div className="flex min-w-0 flex-1 basis-[18rem] items-center gap-3">
              <AccessAvatar name={userLabel(active)} seed={active.id} size="lg" src={active.profile_image_url} />
              <div className="min-w-0">
                <div className="truncate text-[16px] font-bold text-ms-fg">{userLabel(active)}</div>
                <div className="truncate text-[13px] text-ms-fg-3">{active.email}</div>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="primary" icon="plus" onClick={() => setGranting((v) => !v)}>
                Grant access
              </Button>
              <Button
                variant="secondary"
                onClick={() => {
                  setActive(null);
                  setGranting(false);
                  setGrants([]);
                }}
              >
                Change user
              </Button>
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

          {error && <LibraryError>{error}</LibraryError>}

          {/* Grants table */}
          <div className={TABLE_CARD}>
            <div className="overflow-x-auto">
              <table className={TABLE}>
                <thead>
                  <tr>
                    <th scope="col" className={TH}>Access to</th>
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
                        <EmptyState icon="key" title="No access grants yet. Use “Grant access” to add some." />
                      </td>
                    </tr>
                  ) : (
                    grants.map((g) => (
                      <tr key={g.id} className={TR}>
                        <td className={TD}>
                          {grantTarget(g)}
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
        </div>
      )}
    </div>
  );
}
