"use client";

import { useMemo, useState } from "react";
import { Building2, ChevronRight, MapPin, Plus } from "lucide-react";
import { Alert, Badge, Button, Input, Select } from "@/components/ui";
import {
  useBranches,
  useCreateBranch,
  useCreateRegion,
  useOrgClassrooms,
  useRegions,
  useSetClassroomBranch,
} from "@/features/org/orgHooks";
import { OpsPageHeader } from "@/features/ops/OpsPageHeader";

/**
 * Regions, branches, and which branch each classroom meets at.
 *
 * This page is the thing that makes the branch leaderboard work at all. A student's branch is
 * DERIVED from the classroom they study in and is never stored on them — so a classroom with
 * no branch puts its whole roster on no branch board.
 *
 * **It is a drill-down: regions → branches → classrooms.** A flat list of 34 classrooms with a
 * dropdown on each was a wall of selects that answered no question; you could not see which
 * branch was thin, or how many classes still had none. Walking down the hierarchy shows the
 * counts at every step, which is what an administrator is actually looking for.
 *
 * The one bucket that is NOT in the hierarchy is the important one: classrooms with no branch
 * yet. They sit in their own tile at the top level, because they belong to no region and would
 * otherwise be invisible on the very page whose job is to give them one.
 */

/** Where the drill-down is. Nothing → regions; a region → its branches; a branch → its rooms. */
type Crumb =
  | { kind: "regions" }
  | { kind: "branches"; regionId: number; regionName: string }
  | { kind: "rooms"; branchId: number; branchName: string; regionId: number; regionName: string }
  /** Classrooms with no branch at all — outside the hierarchy on purpose. */
  | { kind: "unassigned" };

const TILE =
  "ds-ring flex w-full items-center gap-3 rounded-xl border border-border bg-card px-4 py-3.5 text-left transition-colors hover:border-primary hover:bg-surface-2";

export default function OpsBranchesPage() {
  const regions = useRegions();
  const branches = useBranches();
  const createRegion = useCreateRegion();
  const createBranch = useCreateBranch();
  const setBranch = useSetClassroomBranch();
  const classrooms = useOrgClassrooms();

  const [crumb, setCrumb] = useState<Crumb>({ kind: "regions" });
  const [regionName, setRegionName] = useState("");
  const [branchName, setBranchName] = useState("");
  const [branchRegion, setBranchRegion] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const fail = (e: unknown, fallback: string) => {
    const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
    setError(detail ?? fallback);
  };

  const rows = useMemo(() => classrooms.data ?? [], [classrooms.data]);
  const branchRows = useMemo(() => branches.data ?? [], [branches.data]);
  const regionRows = useMemo(() => regions.data ?? [], [regions.data]);

  /** Classrooms per branch id, counted from the classroom list itself rather than trusting
   *  `branch.classroom_count` — the two must agree, and this page is where a disagreement
   *  would be acted on. */
  const roomsByBranch = useMemo(() => {
    const m = new Map<number, typeof rows>();
    for (const c of rows) {
      if (c.branch == null) continue;
      const list = m.get(c.branch) ?? [];
      list.push(c);
      m.set(c.branch, list);
    }
    return m;
  }, [rows]);

  const unassigned = useMemo(() => rows.filter((c) => c.branch == null), [rows]);

  const branchesByRegion = useMemo(() => {
    const m = new Map<number, typeof branchRows>();
    for (const b of branchRows) {
      const list = m.get(b.region) ?? [];
      list.push(b);
      m.set(b.region, list);
    }
    return m;
  }, [branchRows]);

  const listPending = regions.isPending || branches.isPending || classrooms.isPending;
  const listError = regions.isError || branches.isError || classrooms.isError;

  /** The move control, shared by both places a classroom can be listed. */
  const branchPicker = (c: (typeof rows)[number]) => (
    <div className="w-56 shrink-0">
      <Select
        aria-label={`Branch for ${c.name}`}
        value={c.branch ? String(c.branch) : ""}
        disabled={setBranch.isPending || branchRows.length === 0}
        onChange={(e) => {
          setError(null);
          setNote(null);
          const value = e.target.value;
          setBranch.mutate(
            { classroomId: c.id, branchId: value ? Number(value) : null },
            {
              onSuccess: (r) => {
                setNote(
                  r.students_affected != null
                    ? `${r.detail} ${r.students_affected} student${r.students_affected === 1 ? "" : "s"} moved.`
                    : r.detail,
                );
                void classrooms.refetch();
                void branches.refetch();
              },
              onError: (err) => fail(err, "Couldn't change the branch."),
            },
          );
        }}
      >
        <option value="">— no branch —</option>
        {branchRows.map((b) => (
          <option key={b.id} value={b.id}>
            {b.name} · {b.region_name}
          </option>
        ))}
      </Select>
    </div>
  );

  const classroomList = (list: typeof rows, emptyText: string) =>
    list.length === 0 ? (
      <div className="px-5 py-10 text-center">
        <Building2 className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
        <p className="font-semibold text-foreground">{emptyText}</p>
      </div>
    ) : (
      <ul className="divide-y divide-border">
        {list.map((c) => (
          <li key={c.id} className="flex flex-wrap items-center gap-3 px-5 py-3.5">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-bold text-foreground">{c.name}</p>
              <p className="text-xs font-semibold text-muted-foreground">
                {c.branch ? `${c.branch_name ?? ""} · ${c.region_name ?? ""}` : "No branch"}
              </p>
            </div>
            {branchPicker(c)}
          </li>
        ))}
      </ul>
    );

  return (
    <div className="space-y-5">
      <OpsPageHeader
        section="Branches"
        title="Branches"
        description="A student's branch comes from the classroom they study in — assign a classroom here and its whole roster appears on that branch's leaderboard."
      />

      {error ? <Alert tone="danger">{error}</Alert> : null}
      {note ? <Alert tone="success">{note}</Alert> : null}

      {unassigned.length > 0 && !classrooms.isPending ? (
        <Alert tone="warning">
          {unassigned.length} classroom{unassigned.length === 1 ? "" : "s"}{" "}
          {unassigned.length === 1 ? "has" : "have"} no branch yet. Their students appear on the
          Global board but on no branch board.
        </Alert>
      ) : null}

      {/* Breadcrumb — the only way back up the drill-down. */}
      <nav aria-label="Organisation" className="flex flex-wrap items-center gap-1.5 text-sm font-semibold">
        <button
          type="button"
          onClick={() => setCrumb({ kind: "regions" })}
          className={crumb.kind === "regions" ? "text-foreground" : "text-muted-foreground hover:text-primary"}
        >
          Regions
        </button>
        {crumb.kind === "unassigned" ? (
          <>
            <ChevronRight className="h-4 w-4 text-muted-foreground" aria-hidden />
            <span className="text-foreground">No branch yet</span>
          </>
        ) : null}
        {crumb.kind === "branches" || crumb.kind === "rooms" ? (
          <>
            <ChevronRight className="h-4 w-4 text-muted-foreground" aria-hidden />
            <button
              type="button"
              onClick={() =>
                setCrumb({ kind: "branches", regionId: crumb.regionId, regionName: crumb.regionName })
              }
              className={crumb.kind === "branches" ? "text-foreground" : "text-muted-foreground hover:text-primary"}
            >
              {crumb.regionName}
            </button>
          </>
        ) : null}
        {crumb.kind === "rooms" ? (
          <>
            <ChevronRight className="h-4 w-4 text-muted-foreground" aria-hidden />
            <span className="text-foreground">{crumb.branchName}</span>
          </>
        ) : null}
      </nav>

      {/* Add forms — only at the top of the drill-down, where creating one makes sense. */}
      {crumb.kind === "regions" ? (
        <div className="overflow-hidden rounded-2xl border border-border bg-card">
          <div className="flex items-center gap-2 border-b border-border bg-surface-2 px-5 py-2.5">
            <Plus className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
            <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              Add
            </p>
          </div>
          <div className="grid gap-3 p-5 lg:grid-cols-2">
            <div className="rounded-xl border border-border bg-surface-2 p-3">
              <p className="mb-2 text-[11px] font-extrabold uppercase tracking-[0.06em] text-muted-foreground">
                New region
              </p>
              <div className="flex gap-2">
                <Input
                  placeholder="Tashkent"
                  value={regionName}
                  onChange={(e) => setRegionName(e.target.value)}
                />
                <Button
                  loading={createRegion.isPending}
                  disabled={!regionName.trim()}
                  onClick={() => {
                    setError(null);
                    createRegion.mutate(
                      { name: regionName },
                      { onSuccess: () => setRegionName(""), onError: (e) => fail(e, "Couldn't add it.") },
                    );
                  }}
                >
                  <Plus className="mr-1 h-4 w-4" aria-hidden /> Add
                </Button>
              </div>
            </div>

            <div className="rounded-xl border border-border bg-surface-2 p-3">
              <p className="mb-2 text-[11px] font-extrabold uppercase tracking-[0.06em] text-muted-foreground">
                New branch
              </p>
              {/* `Select` wraps itself in a `w-full` div, so its width has to be set on a
                  container — passing a width in `className` styles the inner <select> only and
                  the control still claims the whole row, which is what pushed this form into
                  three stacked lines. */}
              <div className="flex gap-2">
                <Input
                  className="min-w-0 flex-1"
                  placeholder="Chilonzor"
                  value={branchName}
                  onChange={(e) => setBranchName(e.target.value)}
                />
                <div className="w-36 shrink-0">
                  <Select
                    aria-label="Region for the new branch"
                    value={branchRegion}
                    onChange={(e) => setBranchRegion(e.target.value)}
                  >
                    <option value="">— region —</option>
                    {regionRows.map((r) => (
                      <option key={r.id} value={r.id}>{r.name}</option>
                    ))}
                  </Select>
                </div>
                <Button
                  loading={createBranch.isPending}
                  disabled={!branchName.trim() || !branchRegion}
                  onClick={() => {
                    setError(null);
                    createBranch.mutate(
                      { name: branchName, region: Number(branchRegion) },
                      { onSuccess: () => setBranchName(""), onError: (e) => fail(e, "Couldn't add it.") },
                    );
                  }}
                >
                  <Plus className="mr-1 h-4 w-4" aria-hidden /> Add
                </Button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      <div className="overflow-hidden rounded-2xl border border-border bg-card">
        <div className="flex items-center gap-2 border-b border-border bg-surface-2 px-5 py-2.5">
          <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
            {crumb.kind === "regions"
              ? "Regions"
              : crumb.kind === "branches"
                ? `Branches in ${crumb.regionName}`
                : crumb.kind === "rooms"
                  ? `Classrooms at ${crumb.branchName}`
                  : "Classrooms with no branch"}
          </p>
          {crumb.kind === "regions" ? (
            <span className="ml-auto text-[10px] font-bold text-muted-foreground">
              {rows.length} classroom{rows.length === 1 ? "" : "s"} in total
            </span>
          ) : null}
        </div>

        {listPending ? (
          <div className="divide-y divide-border">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="flex animate-pulse items-center gap-3 px-5 py-3.5">
                <div className="h-4 w-48 rounded bg-muted" />
                <div className="ml-auto h-8 w-40 rounded bg-muted" />
              </div>
            ))}
          </div>
        ) : listError ? (
          // A failed fetch must never render as "no regions" — an admin acting on that would
          // create a second copy of a region that already exists.
          <div className="px-5 py-8 text-center">
            <p className="text-sm font-semibold text-foreground">This didn&apos;t load.</p>
            <button
              type="button"
              onClick={() => {
                void regions.refetch();
                void branches.refetch();
                void classrooms.refetch();
              }}
              className="mt-1 text-sm font-bold text-primary underline"
            >
              Try again
            </button>
          </div>
        ) : crumb.kind === "regions" ? (
          <div className="space-y-2 p-5">
            {regionRows.length === 0 && unassigned.length === 0 ? (
              <div className="px-5 py-10 text-center">
                <MapPin className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
                <p className="font-semibold text-foreground">No regions yet</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Add one, then a branch inside it — until there is a branch, no student has one.
                </p>
              </div>
            ) : null}

            {regionRows.map((r) => {
              const rBranches = branchesByRegion.get(r.id) ?? [];
              const roomCount = rBranches.reduce(
                (n, b) => n + (roomsByBranch.get(b.id)?.length ?? 0),
                0,
              );
              return (
                <button
                  key={r.id}
                  type="button"
                  className={TILE}
                  onClick={() => setCrumb({ kind: "branches", regionId: r.id, regionName: r.name })}
                >
                  <MapPin className="h-4 w-4 shrink-0 text-primary" aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-bold text-foreground">{r.name}</span>
                    <span className="block text-xs font-semibold text-muted-foreground">
                      {rBranches.length} branch{rBranches.length === 1 ? "" : "es"} ·{" "}
                      {roomCount} classroom{roomCount === 1 ? "" : "s"}
                    </span>
                  </span>
                  <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                </button>
              );
            })}

            {/* Outside the hierarchy, and deliberately last so it reads as the outstanding
                job rather than as another region. */}
            {unassigned.length > 0 ? (
              <button
                type="button"
                className={`${TILE} border-dashed`}
                onClick={() => setCrumb({ kind: "unassigned" })}
              >
                <Building2 className="h-4 w-4 shrink-0 text-amber-600" aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-bold text-foreground">No branch yet</span>
                  <span className="block text-xs font-semibold text-muted-foreground">
                    {unassigned.length} classroom{unassigned.length === 1 ? "" : "s"} on no branch
                    board
                  </span>
                </span>
                <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
              </button>
            ) : null}
          </div>
        ) : crumb.kind === "branches" ? (
          <div className="space-y-2 p-5">
            {(branchesByRegion.get(crumb.regionId) ?? []).length === 0 ? (
              <div className="px-5 py-10 text-center">
                <Building2 className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
                <p className="font-semibold text-foreground">No branches here yet</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Add one from the Regions step.
                </p>
              </div>
            ) : (
              (branchesByRegion.get(crumb.regionId) ?? []).map((b) => {
                const count = roomsByBranch.get(b.id)?.length ?? 0;
                return (
                  <button
                    key={b.id}
                    type="button"
                    className={TILE}
                    onClick={() =>
                      setCrumb({
                        kind: "rooms",
                        branchId: b.id,
                        branchName: b.name,
                        regionId: crumb.regionId,
                        regionName: crumb.regionName,
                      })
                    }
                  >
                    <Building2 className="h-4 w-4 shrink-0 text-primary" aria-hidden />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span className="truncate font-bold text-foreground">{b.name}</span>
                        {!b.is_active ? <Badge variant="neutral">Inactive</Badge> : null}
                      </span>
                      <span className="block text-xs font-semibold text-muted-foreground">
                        {count} classroom{count === 1 ? "" : "s"}
                      </span>
                    </span>
                    <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                  </button>
                );
              })
            )}
          </div>
        ) : crumb.kind === "rooms" ? (
          classroomList(roomsByBranch.get(crumb.branchId) ?? [], "No classrooms at this branch yet")
        ) : (
          classroomList(unassigned, "Every classroom has a branch")
        )}
      </div>
    </div>
  );
}
