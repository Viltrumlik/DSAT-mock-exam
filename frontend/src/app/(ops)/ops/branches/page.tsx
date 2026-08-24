"use client";

import { useMemo, useState } from "react";
import { Building2, MapPin, Plus } from "lucide-react";
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
 * Regions, branches, and which branch each classroom sits at.
 *
 * This page is the thing that makes the branch leaderboard work at all. A student's branch is
 * DERIVED from the classroom they study in and is never stored on them — so with no branches
 * and no classroom assigned to one, every student resolves to no branch and the "My Branch"
 * tab hides itself. That is exactly the state production shipped in.
 *
 * Regions and branches share ONE card because they are one thing: a branch only means
 * anything inside its region. Splitting them into two side-by-side lists made a school with
 * two regions and four branches look like a half-empty panel next to a full one, and made the
 * reader join the hierarchy up themselves by matching repeated region names down two columns.
 */
export default function OpsBranchesPage() {
  const regions = useRegions();
  const branches = useBranches();
  const createRegion = useCreateRegion();
  const createBranch = useCreateBranch();
  const setBranch = useSetClassroomBranch();

  const classrooms = useOrgClassrooms();

  const [regionName, setRegionName] = useState("");
  const [branchName, setBranchName] = useState("");
  const [branchRegion, setBranchRegion] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const fail = (e: unknown, fallback: string) => {
    const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
    setError(detail ?? fallback);
  };

  /** Branches under their region — the shape the data actually has. */
  const grouped = useMemo(() => {
    const byRegion = new Map<number, typeof branches.data>();
    for (const b of branches.data ?? []) {
      const list = byRegion.get(b.region) ?? [];
      list.push(b);
      byRegion.set(b.region, list);
    }
    return (regions.data ?? []).map((r) => ({ region: r, items: byRegion.get(r.id) ?? [] }));
  }, [regions.data, branches.data]);

  const unassigned = (classrooms.data ?? []).filter((c) => !c.branch).length;
  const listPending = regions.isPending || branches.isPending;
  const listError = regions.isError || branches.isError;

  return (
    <div className="space-y-5">
      <OpsPageHeader
        section="Branches"
        title="Branches"
        description="A student's branch comes from the classroom they study in — assign a classroom here and its whole roster appears on that branch's leaderboard."
      />

      {error ? <Alert tone="danger">{error}</Alert> : null}
      {note ? <Alert tone="success">{note}</Alert> : null}

      {unassigned > 0 && !classrooms.isPending ? (
        <Alert tone="warning">
          {unassigned} classroom{unassigned === 1 ? "" : "s"} {unassigned === 1 ? "has" : "have"}
          {" "}no branch yet. Their students appear on the Global board but on no branch board.
        </Alert>
      ) : null}

      {/* Flat bordered panels with an uppercase header strip — the idiom Users, Classrooms
          and Exam dates use. These were shadowed `Card`s with bold headings inside, which is
          what made this page read as belonging to a different console. */}
      <div className="overflow-hidden rounded-2xl border border-border bg-card">
        <div className="flex items-center gap-2 border-b border-border bg-surface-2 px-5 py-2.5">
          <MapPin className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
          <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
            Regions and branches
          </p>
        </div>

        {/* Both add-forms on one row: they are the same act at two levels, and a region with
            no branch in it is not yet useful. */}
        <div className="grid gap-3 border-b border-border p-5 lg:grid-cols-2">
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
                <Select value={branchRegion} onChange={(e) => setBranchRegion(e.target.value)}>
                  <option value="">— region —</option>
                  {(regions.data ?? []).map((r) => (
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

        {listPending ? (
          <div className="space-y-3 p-5">
            <div className="h-24 animate-pulse rounded-xl bg-muted" />
          </div>
        ) : listError ? (
          <div className="px-5 py-8 text-center">
            <p className="text-sm font-semibold text-foreground">The list didn&apos;t load.</p>
            <button
              type="button"
              onClick={() => {
                void regions.refetch();
                void branches.refetch();
              }}
              className="mt-1 text-sm font-bold text-primary underline"
            >
              Try again
            </button>
          </div>
        ) : grouped.length === 0 ? (
          <div className="px-5 py-10 text-center">
            <MapPin className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
            <p className="font-semibold text-foreground">No regions yet</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Add one, then a branch inside it — until there is a branch, no student has one.
            </p>
          </div>
        ) : (
          <div className="space-y-3 p-5">
            {grouped.map(({ region, items }) => (
              <div key={region.id} className="rounded-xl border border-border">
                <div className="flex items-center gap-2 border-b border-border px-3 py-2">
                  <MapPin className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
                  <span className="text-sm font-extrabold text-foreground">{region.name}</span>
                  <span className="text-xs font-semibold text-muted-foreground">
                    {items.length} branch{items.length === 1 ? "" : "es"}
                  </span>
                </div>

                {items.length === 0 ? (
                  <p className="px-3 py-2.5 text-xs font-semibold text-muted-foreground">
                    No branches here yet.
                  </p>
                ) : (
                  <ul className="divide-y divide-border">
                    {items.map((b) => (
                      <li key={b.id} className="flex items-center gap-2 px-3 py-2">
                        <Building2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
                        <span className="text-sm font-bold text-foreground">{b.name}</span>
                        {!b.is_active ? <Badge variant="neutral">Inactive</Badge> : null}
                        <span className="ml-auto text-xs font-semibold tabular-nums text-muted-foreground">
                          {b.classroom_count ?? 0} class{(b.classroom_count ?? 0) === 1 ? "" : "es"}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Classroom → branch */}
      <div className="overflow-hidden rounded-2xl border border-border bg-card">
        <div className="border-b border-border bg-surface-2 px-5 py-2.5">
          <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
            Which branch each class meets at
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Changing this moves the whole roster onto that branch&apos;s board.
          </p>
        </div>

        {classrooms.isPending ? (
          <div className="divide-y divide-border">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="flex animate-pulse items-center gap-3 px-5 py-3.5">
                <div className="h-4 w-48 rounded bg-muted" />
                <div className="ml-auto h-8 w-40 rounded bg-muted" />
              </div>
            ))}
          </div>
        ) : classrooms.isError ? (
          <div className="px-5 py-8 text-center">
            <p className="text-sm font-semibold text-foreground">Classrooms didn&apos;t load.</p>
            <button
              type="button"
              onClick={() => void classrooms.refetch()}
              className="mt-1 text-sm font-bold text-primary underline"
            >
              Try again
            </button>
          </div>
        ) : (classrooms.data ?? []).length === 0 ? (
          <div className="px-5 py-10 text-center">
            <Building2 className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
            <p className="font-semibold text-foreground">No classrooms yet</p>
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {(classrooms.data ?? []).map((c) => (
              // One row per class: name on the left, the control on the right. The first
              // version stacked a label above a full-width select, which turned four classes
              // into a page of dropdowns.
              <li key={c.id} className="flex flex-wrap items-center gap-3 px-5 py-3.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-bold text-foreground">{c.name}</p>
                  <p className="text-xs font-semibold text-muted-foreground">
                    {c.branch ? `${c.branch_name ?? ""} · ${c.region_name ?? ""}` : "No branch"}
                  </p>
                </div>
                <div className="w-56 shrink-0">
                <Select
                  value={c.branch ? String(c.branch) : ""}
                  disabled={setBranch.isPending || (branches.data ?? []).length === 0}
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
                        },
                        onError: (err) => fail(err, "Couldn't change the branch."),
                      },
                    );
                  }}
                >
                  <option value="">— no branch —</option>
                  {(branches.data ?? []).map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name} · {b.region_name}
                    </option>
                  ))}
                </Select>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
