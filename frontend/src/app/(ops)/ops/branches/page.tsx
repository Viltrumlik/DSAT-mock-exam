"use client";

import { useMemo, useState } from "react";
import { Building2, MapPin, Plus } from "lucide-react";
import { Alert, Badge, Button, Card, Input, Select, Skeleton } from "@/components/ui";
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

      <Card className="space-y-4">
        <h2 className="flex items-center gap-2 text-base font-extrabold">
          <MapPin className="h-4 w-4 text-primary" aria-hidden /> Regions and branches
        </h2>

        {/* Both add-forms on one row: they are the same act at two levels, and a region with
            no branch in it is not yet useful. */}
        <div className="grid gap-3 lg:grid-cols-2">
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
          <Skeleton className="h-32 rounded-xl" />
        ) : listError ? (
          <Alert tone="danger">
            The list didn&apos;t load.{" "}
            <button
              className="underline"
              onClick={() => {
                void regions.refetch();
                void branches.refetch();
              }}
            >
              Try again
            </button>
          </Alert>
        ) : grouped.length === 0 ? (
          <p className="text-sm font-semibold text-muted-foreground">
            No regions yet. Add one, then a branch inside it — until there is a branch, no
            student has one.
          </p>
        ) : (
          <div className="space-y-3">
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
      </Card>

      {/* Classroom → branch */}
      <Card className="space-y-3">
        <div>
          <h2 className="text-base font-extrabold">Which branch each class meets at</h2>
          <p className="text-sm font-medium text-muted-foreground">
            Changing this moves the whole roster onto that branch&apos;s board.
          </p>
        </div>

        {classrooms.isPending ? (
          <Skeleton className="h-40 rounded-xl" />
        ) : classrooms.isError ? (
          <Alert tone="danger">
            Classrooms didn&apos;t load.{" "}
            <button className="underline" onClick={() => void classrooms.refetch()}>Try again</button>
          </Alert>
        ) : (classrooms.data ?? []).length === 0 ? (
          <p className="text-sm font-semibold text-muted-foreground">No classrooms yet.</p>
        ) : (
          <ul className="divide-y divide-border">
            {(classrooms.data ?? []).map((c) => (
              // One row per class: name on the left, the control on the right. The first
              // version stacked a label above a full-width select, which turned four classes
              // into a page of dropdowns.
              <li key={c.id} className="flex flex-wrap items-center gap-3 py-2.5">
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
      </Card>
    </div>
  );
}
