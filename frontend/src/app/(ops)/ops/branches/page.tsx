"use client";

import { useMemo, useState, type ReactNode } from "react";

import { Icon, type IconName } from "@/components/ui/Icon";
import { Badge, Button, EmptyState } from "@/features/console/ui";
import {
  useBranches,
  useCreateBranch,
  useCreateRegion,
  useOrgClassrooms,
  useRegions,
  useSetClassroomBranch,
} from "@/features/org/orgHooks";
import { OpsPageHeader } from "@/features/ops/OpsPageHeader";
import { CaptionCount, LoadFailed, Notice, Panel, SkeletonRows } from "@/features/ops/settings/settingsParts";
import { CONTROL, FIELD_LABEL } from "@/features/questionsAdmin/questionLook";
import { cn } from "@/lib/cn";

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
 *
 * In the console's look (design handoff v0.3): cards, the console's fields and buttons, a tile per
 * step. The words, the drill-down and the calls are the page's own.
 */

/** Where the drill-down is. Nothing → regions; a region → its branches; a branch → its rooms. */
type Crumb =
  | { kind: "regions" }
  | { kind: "branches"; regionId: number; regionName: string }
  | { kind: "rooms"; branchId: number; branchName: string; regionId: number; regionName: string }
  /** Classrooms with no branch at all — outside the hierarchy on purpose. */
  | { kind: "unassigned" };

const TILE =
  "ms-transition ms-press flex w-full items-center gap-3 rounded-ms-ctl border border-ms-line bg-ms-card px-4 py-3.5 text-left hover:border-ms-border-strong hover:bg-ms-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ms-ring";

/** One step down the drill-down: its icon, its name, its counts, and the chevron that says it opens. */
function Tile({
  icon,
  tone = "primary",
  dashed = false,
  title,
  badge,
  detail,
  onOpen,
}: {
  icon: IconName;
  tone?: "primary" | "attention";
  dashed?: boolean;
  title: string;
  badge?: ReactNode;
  detail: ReactNode;
  onOpen: () => void;
}) {
  return (
    <button type="button" className={cn(TILE, dashed && "border-dashed border-ms-border-strong")} onClick={onOpen}>
      <span
        className={cn(
          "grid size-9 shrink-0 place-items-center rounded-[10px]",
          tone === "attention" ? "bg-ms-attention-soft text-ms-attention-fg" : "bg-ms-primary-soft text-ms-primary-text",
        )}
      >
        <Icon name={icon} size="sm" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-center gap-2">
          <span className="truncate text-[15px] font-semibold leading-[22px] text-ms-fg">{title}</span>
          {badge}
        </span>
        <span className="block text-[13px] text-ms-fg-2">{detail}</span>
      </span>
      <Icon name="right" size="sm" className="text-ms-fg-3" />
    </button>
  );
}

/** A step of the breadcrumb: a button while it leads back up, plain words where you are. */
function CrumbStep({ current, onClick, children }: { current: boolean; onClick?: () => void; children: ReactNode }) {
  return current || !onClick ? (
    <span aria-current={current ? "page" : undefined} className="rounded-[8px] px-2 py-1 font-semibold text-ms-fg">
      {children}
    </span>
  ) : (
    <button
      type="button"
      onClick={onClick}
      className="ms-transition rounded-[8px] px-2 py-1 font-semibold text-ms-primary-text hover:bg-ms-surface-2"
    >
      {children}
    </button>
  );
}

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
    // Sized on a wrapper: CONTROL carries `w-full`, and `cn` would emit a second width beside it.
    <div className="w-full sm:w-56">
      <select
        aria-label={`Branch for ${c.name}`}
        className={CONTROL}
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
      </select>
    </div>
  );

  const classroomList = (list: typeof rows, emptyText: string) =>
    list.length === 0 ? (
      <EmptyState icon="ms-room" title={emptyText} />
    ) : (
      <ul className="divide-y divide-ms-line">
        {list.map((c) => (
          <li key={c.id} data-classroom={c.id} className="ms-transition flex flex-wrap items-center gap-3 px-5 py-3.5 hover:bg-ms-surface">
            <div className="min-w-0 flex-1 basis-[14rem]">
              <p className="truncate text-[15px] font-semibold leading-[22px] text-ms-fg">{c.name}</p>
              <p className="text-[13px] text-ms-fg-2">
                {c.branch ? `${c.branch_name ?? ""} · ${c.region_name ?? ""}` : "No branch"}
              </p>
            </div>
            {branchPicker(c)}
          </li>
        ))}
      </ul>
    );

  return (
    <div className="flex flex-col gap-5">
      <OpsPageHeader
        section="Branches"
        title="Branches"
        description="A student's branch comes from the classroom they study in — assign a classroom here and its whole roster appears on that branch's leaderboard."
      />

      {error ? <Notice tone="danger">{error}</Notice> : null}
      {note ? <Notice tone="success">{note}</Notice> : null}

      {unassigned.length > 0 && !classrooms.isPending ? (
        <Notice tone="warning">
          {unassigned.length} classroom{unassigned.length === 1 ? "" : "s"}{" "}
          {unassigned.length === 1 ? "has" : "have"} no branch yet. Their students appear on the
          Global board but on no branch board.
        </Notice>
      ) : null}

      {/* Breadcrumb — the only way back up the drill-down. */}
      <nav aria-label="Organisation" className="animate-ms-fade-in -mx-2 flex flex-wrap items-center gap-1 text-[14px]">
        <CrumbStep current={crumb.kind === "regions"} onClick={() => setCrumb({ kind: "regions" })}>
          Regions
        </CrumbStep>
        {crumb.kind === "unassigned" ? (
          <>
            <Icon name="right" size="sm" className="text-ms-fg-3" />
            <CrumbStep current>No branch yet</CrumbStep>
          </>
        ) : null}
        {crumb.kind === "branches" || crumb.kind === "rooms" ? (
          <>
            <Icon name="right" size="sm" className="text-ms-fg-3" />
            <CrumbStep
              current={crumb.kind === "branches"}
              onClick={() => setCrumb({ kind: "branches", regionId: crumb.regionId, regionName: crumb.regionName })}
            >
              {crumb.regionName}
            </CrumbStep>
          </>
        ) : null}
        {crumb.kind === "rooms" ? (
          <>
            <Icon name="right" size="sm" className="text-ms-fg-3" />
            <CrumbStep current>{crumb.branchName}</CrumbStep>
          </>
        ) : null}
      </nav>

      {/* Add forms — only at the top of the drill-down, where creating one makes sense. */}
      {crumb.kind === "regions" ? (
        <Panel title="Add" icon="plus">
          <div className="grid gap-3 p-4 sm:p-5 lg:grid-cols-2">
            <div className="rounded-ms-ctl bg-ms-surface p-3.5">
              <label htmlFor="ops-new-region" className={FIELD_LABEL}>
                New region
              </label>
              <div className="flex flex-wrap gap-2">
                <div className="min-w-0 flex-1 basis-[10rem]">
                  <input
                    id="ops-new-region"
                    className={CONTROL}
                    placeholder="Tashkent"
                    value={regionName}
                    onChange={(e) => setRegionName(e.target.value)}
                  />
                </div>
                <Button
                  variant="primary"
                  icon="plus"
                  state={createRegion.isPending ? "busy" : "idle"}
                  disabled={!regionName.trim() || createRegion.isPending}
                  onClick={() => {
                    setError(null);
                    createRegion.mutate(
                      { name: regionName },
                      { onSuccess: () => setRegionName(""), onError: (e) => fail(e, "Couldn't add it.") },
                    );
                  }}
                >
                  Add
                </Button>
              </div>
            </div>

            <div className="rounded-ms-ctl bg-ms-surface p-3.5">
              <label htmlFor="ops-new-branch" className={FIELD_LABEL}>
                New branch
              </label>
              {/* Each control sized on its own wrapper, so the name takes what the region picker
                  and the button leave — and the row wraps on a phone instead of squeezing. */}
              <div className="flex flex-wrap gap-2">
                <div className="min-w-0 flex-1 basis-[10rem]">
                  <input
                    id="ops-new-branch"
                    className={CONTROL}
                    placeholder="Chilonzor"
                    value={branchName}
                    onChange={(e) => setBranchName(e.target.value)}
                  />
                </div>
                <div className="w-36">
                  <select
                    aria-label="Region for the new branch"
                    className={CONTROL}
                    value={branchRegion}
                    onChange={(e) => setBranchRegion(e.target.value)}
                  >
                    <option value="">— region —</option>
                    {regionRows.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name}
                      </option>
                    ))}
                  </select>
                </div>
                <Button
                  variant="primary"
                  icon="plus"
                  state={createBranch.isPending ? "busy" : "idle"}
                  disabled={!branchName.trim() || !branchRegion || createBranch.isPending}
                  onClick={() => {
                    setError(null);
                    createBranch.mutate(
                      { name: branchName, region: Number(branchRegion) },
                      { onSuccess: () => setBranchName(""), onError: (e) => fail(e, "Couldn't add it.") },
                    );
                  }}
                >
                  Add
                </Button>
              </div>
            </div>
          </div>
        </Panel>
      ) : null}

      <Panel
        title={
          crumb.kind === "regions"
            ? "Regions"
            : crumb.kind === "branches"
              ? `Branches in ${crumb.regionName}`
              : crumb.kind === "rooms"
                ? `Classrooms at ${crumb.branchName}`
                : "Classrooms with no branch"
        }
        aside={
          crumb.kind === "regions" ? (
            <CaptionCount>
              {rows.length} classroom{rows.length === 1 ? "" : "s"} in total
            </CaptionCount>
          ) : null
        }
      >
        {listPending ? (
          <SkeletonRows count={4} />
        ) : listError ? (
          // A failed fetch must never render as "no regions" — an admin acting on that would
          // create a second copy of a region that already exists.
          <LoadFailed
            onRetry={() => {
              void regions.refetch();
              void branches.refetch();
              void classrooms.refetch();
            }}
          >
            This didn&apos;t load.
          </LoadFailed>
        ) : crumb.kind === "regions" ? (
          <div className="flex flex-col gap-2 p-4 sm:p-5">
            {regionRows.length === 0 && unassigned.length === 0 ? (
              <EmptyState
                icon="ms-branch"
                title="No regions yet"
                detail="Add one, then a branch inside it — until there is a branch, no student has one."
              />
            ) : null}

            {regionRows.map((r) => {
              const rBranches = branchesByRegion.get(r.id) ?? [];
              const roomCount = rBranches.reduce((n, b) => n + (roomsByBranch.get(b.id)?.length ?? 0), 0);
              return (
                <Tile
                  key={r.id}
                  icon="ms-branch"
                  title={r.name}
                  detail={
                    <>
                      {rBranches.length} branch{rBranches.length === 1 ? "" : "es"} · {roomCount} classroom
                      {roomCount === 1 ? "" : "s"}
                    </>
                  }
                  onOpen={() => setCrumb({ kind: "branches", regionId: r.id, regionName: r.name })}
                />
              );
            })}

            {/* Outside the hierarchy, and deliberately last so it reads as the outstanding
                job rather than as another region. */}
            {unassigned.length > 0 ? (
              <Tile
                icon="building"
                tone="attention"
                dashed
                title="No branch yet"
                detail={
                  <>
                    {unassigned.length} classroom{unassigned.length === 1 ? "" : "s"} on no branch board
                  </>
                }
                onOpen={() => setCrumb({ kind: "unassigned" })}
              />
            ) : null}
          </div>
        ) : crumb.kind === "branches" ? (
          <div className="flex flex-col gap-2 p-4 sm:p-5">
            {(branchesByRegion.get(crumb.regionId) ?? []).length === 0 ? (
              <EmptyState icon="building" title="No branches here yet" detail="Add one from the Regions step." />
            ) : (
              (branchesByRegion.get(crumb.regionId) ?? []).map((b) => {
                const count = roomsByBranch.get(b.id)?.length ?? 0;
                return (
                  <Tile
                    key={b.id}
                    icon="building"
                    title={b.name}
                    badge={!b.is_active ? <Badge tone="neutral">Inactive</Badge> : null}
                    detail={
                      <>
                        {count} classroom{count === 1 ? "" : "s"}
                      </>
                    }
                    onOpen={() =>
                      setCrumb({
                        kind: "rooms",
                        branchId: b.id,
                        branchName: b.name,
                        regionId: crumb.regionId,
                        regionName: crumb.regionName,
                      })
                    }
                  />
                );
              })
            )}
          </div>
        ) : crumb.kind === "rooms" ? (
          classroomList(roomsByBranch.get(crumb.branchId) ?? [], "No classrooms at this branch yet")
        ) : (
          classroomList(unassigned, "Every classroom has a branch")
        )}
      </Panel>
    </div>
  );
}
