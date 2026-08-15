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

/**
 * Regions, branches, and which branch each classroom sits at.
 *
 * This page is the thing that makes the branch leaderboard work at all. A student's branch is
 * DERIVED from the classroom they study in and is never stored on them — so with no branches
 * and no classroom assigned to one, every student resolves to no branch and the "My Branch"
 * tab hides itself. That is exactly the state production shipped in.
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

  const branchById = useMemo(
    () => new Map((branches.data ?? []).map((b) => [b.id, b])),
    [branches.data],
  );

  const fail = (e: unknown, fallback: string) => {
    const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
    setError(detail ?? fallback);
  };

  const unassigned = (classrooms.data ?? []).filter((c) => !c.branch).length;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight">Branches</h1>
        <p className="text-sm font-medium text-muted-foreground">
          A student&apos;s branch comes from the classroom they study in — assign a classroom
          here and its whole roster appears on that branch&apos;s leaderboard.
        </p>
      </div>

      {error ? <Alert tone="danger">{error}</Alert> : null}
      {note ? <Alert tone="success">{note}</Alert> : null}

      {unassigned > 0 && !classrooms.isPending ? (
        <Alert tone="warning">
          {unassigned} classroom{unassigned === 1 ? "" : "s"} {unassigned === 1 ? "has" : "have"}
          {" "}no branch yet. Their students appear on the Global board but on no branch board.
        </Alert>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Regions */}
        <Card className="space-y-3">
          <h2 className="flex items-center gap-2 text-lg font-extrabold">
            <MapPin className="h-4 w-4" aria-hidden /> Regions
          </h2>
          <div className="flex gap-2">
            <Input
              placeholder="Tashkent"
              value={regionName}
              onChange={(e) => setRegionName(e.target.value)}
            />
            <Button
              loading={createRegion.isPending}
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

          {regions.isPending ? (
            <Skeleton className="h-20 rounded-xl" />
          ) : regions.isError ? (
            <Alert tone="danger">
              Regions didn&apos;t load.{" "}
              <button className="underline" onClick={() => void regions.refetch()}>Try again</button>
            </Alert>
          ) : regions.data.length === 0 ? (
            <p className="text-sm font-semibold text-muted-foreground">
              No regions yet. Add one, then a branch inside it.
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {regions.data.map((r) => (
                <li key={r.id} className="flex items-center justify-between py-2 text-sm">
                  <span className="font-bold">{r.name}</span>
                  <span className="text-xs font-semibold text-muted-foreground">
                    {r.branch_count ?? 0} branch{(r.branch_count ?? 0) === 1 ? "" : "es"}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {/* Branches */}
        <Card className="space-y-3">
          <h2 className="flex items-center gap-2 text-lg font-extrabold">
            <Building2 className="h-4 w-4" aria-hidden /> Branches
          </h2>
          <div className="grid grid-cols-2 gap-2">
            <Input
              placeholder="Chilonzor"
              value={branchName}
              onChange={(e) => setBranchName(e.target.value)}
            />
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
            <Plus className="mr-1 h-4 w-4" aria-hidden /> Add branch
          </Button>

          {branches.isPending ? (
            <Skeleton className="h-20 rounded-xl" />
          ) : branches.isError ? (
            <Alert tone="danger">
              Branches didn&apos;t load.{" "}
              <button className="underline" onClick={() => void branches.refetch()}>Try again</button>
            </Alert>
          ) : branches.data.length === 0 ? (
            <p className="text-sm font-semibold text-muted-foreground">
              No branches yet — until there is one, no student has a branch.
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {branches.data.map((b) => (
                <li key={b.id} className="flex items-center justify-between py-2 text-sm">
                  <span>
                    <span className="font-bold">{b.name}</span>{" "}
                    <span className="text-xs text-muted-foreground">{b.region_name}</span>
                    {!b.is_active ? <Badge variant="neutral">Inactive</Badge> : null}
                  </span>
                  <span className="text-xs font-semibold text-muted-foreground">
                    {b.classroom_count ?? 0} class{(b.classroom_count ?? 0) === 1 ? "" : "es"}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {/* Classroom → branch */}
      <Card className="space-y-3">
        <h2 className="text-lg font-extrabold">Which branch each class meets at</h2>
        <p className="text-sm font-medium text-muted-foreground">
          Changing this moves the whole roster onto that branch&apos;s board.
        </p>

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
              <li key={c.id} className="flex flex-wrap items-center gap-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-bold">{c.name}</p>
                  <p className="text-xs font-semibold text-muted-foreground">
                    {c.branch ? branchById.get(c.branch)?.region_name ?? "" : "No branch"}
                  </p>
                </div>
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
                  className="w-56"
                >
                  <option value="">— no branch —</option>
                  {(branches.data ?? []).map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name} · {b.region_name}
                    </option>
                  ))}
                </Select>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
