"use client";

import { useState } from "react";
import { Alert, Badge, Button, Input, Select } from "@/components/ui";
import type { BadgeVariant } from "@/components/ui/Badge";
import { useOrgClassrooms } from "@/features/org/orgHooks";
import { formatApiErrorForToast } from "@/lib/apiError";
import {
  lcupApi,
  type ClaimState,
  type GroupLinkStatus,
  type LcupGroup,
  type LcupPerson,
  type LcupRun,
  type LinkStatus,
  type StudentFilter,
} from "./lcupApi";
import {
  useLcupAccounts,
  useLcupAction,
  useLcupGroups,
  useLcupStatus,
  useLcupStudents,
  useLcupTeachers,
  useLcupUnlinked,
} from "./lcupHooks";

/**
 * The five panels of /ops/lcup. Every write goes through `useLcupAction`, which refetches
 * everything under ["lcup"]: one link moves counts, queues and the classes still free to pair.
 *
 * A failed read renders an error with a retry, never the empty state — "nobody to review" and
 * "the review list did not load" must not look the same on a page whose job is the review.
 */

const CARD = "rounded-xl border border-border bg-card p-4";
const DAY = ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function when(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });
}

function Loading() {
  return <p className="text-sm text-muted-foreground">Loading…</p>;
}

function LoadError({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  return (
    <Alert tone="danger" title="This list did not load">
      <div className="flex flex-wrap items-center gap-3">
        <span>{formatApiErrorForToast(error)}</span>
        <Button size="sm" variant="outline" onClick={onRetry}>
          Retry
        </Button>
      </div>
    </Alert>
  );
}

function ActionError({ error }: { error: unknown }) {
  if (!error) return null;
  return (
    <div className="mt-2">
      <Alert tone="danger">{formatApiErrorForToast(error)}</Alert>
    </div>
  );
}

// ── status ───────────────────────────────────────────────────────────────

function Tile({ label, value }: { label: string; value: number }) {
  return (
    <div className={CARD}>
      <p className="text-xs font-semibold text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-foreground">{value}</p>
    </div>
  );
}

function RunRow({ run }: { run: LcupRun }) {
  const counts = Object.entries(run.counts).filter(([, n]) => n);
  return (
    <li className="border-t border-border py-3 first:border-t-0 first:pt-0">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-semibold text-foreground">{when(run.started_at)}</span>
        {run.dry_run ? <Badge variant="outline">Dry run</Badge> : null}
        <Badge variant={run.ok ? "success" : "danger"}>{run.ok ? "OK" : "Errors"}</Badge>
      </div>
      {counts.length ? (
        <p className="mt-1 text-xs text-muted-foreground">
          {counts.map(([key, n]) => `${key.replace(/_/g, " ")}: ${n}`).join(" · ")}
        </p>
      ) : null}
      {run.alerts.map((alert) => (
        <p key={alert} className="mt-1 text-xs text-foreground">
          ⚠ {alert}
        </p>
      ))}
      {run.errors.map((err) => (
        <p key={`${err.stage}-${err.error}`} className="mt-1 text-xs text-danger">
          {err.stage}: {err.error}
        </p>
      ))}
    </li>
  );
}

export function StatusPanel() {
  const q = useLcupStatus();
  const sync = useLcupAction((dryRun: boolean) => lcupApi.sync(dryRun));
  const done = useLcupAction(() => lcupApi.reviewDone());
  const [confirming, setConfirming] = useState(false);

  if (q.isLoading) return <Loading />;
  if (q.error || !q.data) return <LoadError error={q.error} onRetry={() => void q.refetch()} />;
  const status = q.data;
  const c = status.counts;

  return (
    <div className="space-y-4">
      <div className={CARD}>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={status.enabled ? "success" : "neutral"}>{status.enabled ? "Sync on" : "Sync off"}</Badge>
          <Badge variant={status.initial_review_done_at ? "success" : "warning"}>
            {status.initial_review_done_at
              ? `Initial review done ${when(status.initial_review_done_at)}`
              : "Initial review not done yet"}
          </Badge>
          <div className="ml-auto flex gap-2">
            <Button size="sm" variant="outline" disabled={sync.isPending} onClick={() => sync.mutate(true)}>
              Dry run
            </Button>
            <Button size="sm" disabled={!status.enabled || sync.isPending} onClick={() => sync.mutate(false)}>
              Sync now
            </Button>
          </div>
        </div>
        {sync.isSuccess ? (
          <p className="mt-2 text-sm text-muted-foreground">Queued — the run appears below when the worker finishes it.</p>
        ) : null}
        <ActionError error={sync.error} />
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Tile label="Students to review" value={c.needs_review_students} />
        <Tile label="Students with no match" value={c.unmatched_students} />
        <Tile label="Teachers to link" value={c.needs_review_teachers} />
        <Tile label="Groups to pair" value={c.groups_pending} />
        <Tile label="Accounts not claimed yet" value={c.unclaimed_accounts} />
      </div>

      <div className={CARD}>
        <h3 className="text-sm font-semibold text-foreground">Initial review</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Until this is marked done, the sync only links and suggests. Once every student who already has an
          account is linked, mark it done: from the next sync, accounts are created for the rest, and classes for
          groups that match none of ours.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {confirming ? (
            <>
              <Button size="sm" disabled={done.isPending} onClick={() => done.mutate(undefined, { onSuccess: () => setConfirming(false) })}>
                Yes, mark it done
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>
                Cancel
              </Button>
            </>
          ) : (
            <Button
              size="sm"
              variant="secondary"
              disabled={Boolean(status.initial_review_done_at) || c.needs_review_students > 0}
              onClick={() => setConfirming(true)}
            >
              Mark initial review done
            </Button>
          )}
        </div>
        <ActionError error={done.error} />
      </div>

      <div className={CARD}>
        <h3 className="mb-3 text-sm font-semibold text-foreground">Recent runs</h3>
        {status.recent_runs.length ? (
          <ul>
            {status.recent_runs.map((run) => (
              <RunRow key={run.id} run={run} />
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">No sync has run yet. A dry run shows what the first one would do.</p>
        )}
      </div>
    </div>
  );
}

// ── groups ───────────────────────────────────────────────────────────────

const GROUP_BADGE: Record<GroupLinkStatus, { variant: BadgeVariant; label: string }> = {
  suggested: { variant: "warning", label: "To pair" },
  needs_teacher: { variant: "warning", label: "Link its teacher first" },
  confirmed: { variant: "success", label: "Paired" },
  ignored: { variant: "outline", label: "Ignored" },
};

const GROUP_ORDER: Record<GroupLinkStatus, number> = { suggested: 0, needs_teacher: 1, confirmed: 2, ignored: 3 };

function GroupRow({ group, freeRooms }: { group: LcupGroup; freeRooms: { id: number; name: string }[] }) {
  const [choice, setChoice] = useState(group.suggestion ? String(group.suggestion.id) : "");
  const confirm = useLcupAction((classroomId: number | undefined) => lcupApi.confirmGroup(group.id, classroomId));
  const create = useLcupAction(() => lcupApi.createClass(group.id));
  const ignore = useLcupAction(() => lcupApi.ignoreGroup(group.id));
  const badge = GROUP_BADGE[group.status];
  const open = !group.deleted && group.status !== "confirmed" && group.status !== "ignored";
  const busy = confirm.isPending || create.isPending || ignore.isPending;

  return (
    <li className={CARD}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold text-foreground">{group.name}</span>
        <Badge variant={badge.variant}>{badge.label}</Badge>
        {group.deleted ? <Badge variant="danger">Deleted in lc-up</Badge> : null}
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        {[group.course, group.days.map((d) => DAY[d] ?? d).join("/"), group.start_time && `${group.start_time}–${group.finish_time}`, group.teachers.join(", "), group.member_count != null && `${group.member_count} in lc-up`]
          .filter(Boolean)
          .join(" · ")}
      </p>

      {group.classroom ? (
        <p className="mt-2 text-sm text-foreground">Paired with {group.classroom.name}</p>
      ) : group.suggestion ? (
        <div className="mt-2 flex flex-wrap items-center gap-1.5 text-sm">
          <span className="text-foreground">
            Suggested: <span className="font-semibold">{group.suggestion.name}</span> ({group.suggestion.score}/14)
          </span>
          {group.suggestion.reasons.map((reason) => (
            <Badge key={reason} variant="outline">
              {reason}
            </Badge>
          ))}
        </div>
      ) : null}
      {group.notes.map((note) => (
        <p key={note} className="mt-1 text-xs text-muted-foreground">
          {note}
        </p>
      ))}

      {open ? (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <div className="w-64">
            <Select selectSize="sm" aria-label={`Class for ${group.name}`} value={choice} onChange={(e) => setChoice(e.target.value)}>
              <option value="">Choose a class…</option>
              {group.suggestion && !freeRooms.some((r) => r.id === group.suggestion!.id) ? (
                <option value={group.suggestion.id}>{group.suggestion.name}</option>
              ) : null}
              {freeRooms.map((room) => (
                <option key={room.id} value={room.id}>
                  {room.name}
                </option>
              ))}
            </Select>
          </div>
          <Button size="sm" disabled={busy || !choice} onClick={() => confirm.mutate(Number(choice))}>
            Pair
          </Button>
          <Button size="sm" variant="outline" disabled={busy} onClick={() => create.mutate(undefined)}>
            Create a new class
          </Button>
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => ignore.mutate(undefined)}>
            Ignore
          </Button>
        </div>
      ) : null}
      <ActionError error={confirm.error || create.error || ignore.error} />
    </li>
  );
}

export function GroupsPanel() {
  const q = useLcupGroups();
  const rooms = useOrgClassrooms();
  if (q.isLoading) return <Loading />;
  if (q.error || !q.data) return <LoadError error={q.error} onRetry={() => void q.refetch()} />;

  const taken = new Set(q.data.flatMap((g) => (g.classroom ? [g.classroom.id] : [])));
  const freeRooms = (rooms.data ?? []).filter((room) => !taken.has(room.id)).map((room) => ({ id: room.id, name: room.name }));
  const groups = [...q.data].sort(
    (a, b) => Number(a.deleted) - Number(b.deleted) || GROUP_ORDER[a.status] - GROUP_ORDER[b.status] || a.name.localeCompare(b.name),
  );

  if (!groups.length) {
    return <p className="text-sm text-muted-foreground">No lc-up groups yet. They appear after the first sync.</p>;
  }
  return (
    <div className="space-y-3">
      {rooms.error ? <Alert tone="warning">Our class list did not load, so only suggested classes can be chosen.</Alert> : null}
      <ul className="space-y-3">
        {groups.map((group) => (
          <GroupRow key={group.id} group={group} freeRooms={freeRooms} />
        ))}
      </ul>
    </div>
  );
}

// ── students and teachers ────────────────────────────────────────────────

const LINK_BADGE: Record<LinkStatus, { variant: BadgeVariant; label: string }> = {
  auto: { variant: "success", label: "Auto-linked" },
  confirmed: { variant: "success", label: "Linked" },
  created: { variant: "info", label: "Account created" },
  needs_review: { variant: "warning", label: "Needs review" },
  unmatched: { variant: "neutral", label: "No match" },
  ignored: { variant: "outline", label: "Ignored" },
};

function PersonRow({ person, kind }: { person: LcupPerson; kind: "students" | "teachers" }) {
  const [accountId, setAccountId] = useState("");
  const [phone, setPhone] = useState("");
  const link = useLcupAction((userId: number) =>
    kind === "students" ? lcupApi.linkStudent(person.id, userId) : lcupApi.linkTeacher(person.id, userId),
  );
  const ignore = useLcupAction(() => (kind === "students" ? lcupApi.ignoreStudent(person.id) : lcupApi.ignoreTeacher(person.id)));
  const create = useLcupAction((otherPhone: string) => lcupApi.createAccount(person.id, otherPhone || undefined));
  const badge = LINK_BADGE[person.status];
  const busy = link.isPending || ignore.isPending || create.isPending;

  return (
    <li className={CARD}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold text-foreground">{person.name}</span>
        <Badge variant={badge.variant}>{badge.label}</Badge>
        <span className="text-xs text-muted-foreground">{person.phone || "no phone in lc-up"}</span>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        {[person.groups.join(", "), person.reason].filter(Boolean).join(" · ")}
      </p>
      {person.user ? (
        <p className="mt-1 text-sm text-foreground">
          Linked to {person.user.name} ({person.user.username})
        </p>
      ) : null}

      {person.candidates.length ? (
        <ul className="mt-2 space-y-1">
          {person.candidates.map((candidate) => (
            <li key={candidate.user_id} className="flex flex-wrap items-center gap-2 text-sm">
              <span className="text-foreground">{candidate.name}</span>
              <span className="text-xs text-muted-foreground">{candidate.reason}</span>
              <Button size="sm" variant="outline" disabled={busy} onClick={() => link.mutate(candidate.user_id)}>
                Link
              </Button>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <div className="w-40">
          <Input
            aria-label="Account ID"
            placeholder="Account ID"
            inputMode="numeric"
            value={accountId}
            onChange={(e) => setAccountId(e.target.value.replace(/\D/g, ""))}
          />
        </div>
        <Button size="sm" variant="outline" disabled={busy || !accountId} onClick={() => link.mutate(Number(accountId))}>
          Link to this account
        </Button>
        {kind === "students" && !person.user ? (
          <>
            <div className="w-48">
              <Input aria-label="Another phone" placeholder="Another phone (siblings)" value={phone} onChange={(e) => setPhone(e.target.value)} />
            </div>
            <Button size="sm" disabled={busy} onClick={() => create.mutate(phone)}>
              Create account
            </Button>
          </>
        ) : null}
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => ignore.mutate(undefined)}>
          Ignore
        </Button>
      </div>
      <ActionError error={link.error || ignore.error || create.error} />
    </li>
  );
}

function UnlinkedMembers() {
  const q = useLcupUnlinked();
  if (q.isLoading) return <Loading />;
  if (q.error || !q.data) return <LoadError error={q.error} onRetry={() => void q.refetch()} />;
  if (!q.data.length) return <p className="text-sm text-muted-foreground">Every student of a paired class is linked to lc-up.</p>;
  return (
    <ul className="space-y-1 text-sm">
      {q.data.map((row) => (
        <li key={`${row.classroom.id}-${row.user.id}`} className="text-foreground">
          {row.user.name} <span className="text-muted-foreground">· {row.classroom.name} · account {row.user.id}</span>
        </li>
      ))}
    </ul>
  );
}

export function StudentsPanel() {
  const [filter, setFilter] = useState<StudentFilter>("needs_review");
  const q = useLcupStudents(filter);

  return (
    <div className="space-y-4">
      <div className="w-64">
        <Select selectSize="sm" aria-label="Which students" value={filter} onChange={(e) => setFilter(e.target.value as StudentFilter)}>
          <option value="needs_review">Needs review</option>
          <option value="unmatched">No match yet</option>
          <option value="all">Everyone in a live group</option>
        </Select>
      </div>
      {q.isLoading ? (
        <Loading />
      ) : q.error || !q.data ? (
        <LoadError error={q.error} onRetry={() => void q.refetch()} />
      ) : q.data.length ? (
        <ul className="space-y-3">
          {q.data.map((person) => (
            <PersonRow key={person.id} person={person} kind="students" />
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">Nobody here.</p>
      )}
      <div className={CARD}>
        <h3 className="mb-2 text-sm font-semibold text-foreground">In our paired classes, but not linked to lc-up</h3>
        <p className="mb-3 text-xs text-muted-foreground">
          The sync never removes these students. Link each one to their lc-up record above, or leave them if they
          are not lc-up students.
        </p>
        <UnlinkedMembers />
      </div>
    </div>
  );
}

export function TeachersPanel() {
  const q = useLcupTeachers();
  if (q.isLoading) return <Loading />;
  if (q.error || !q.data) return <LoadError error={q.error} onRetry={() => void q.refetch()} />;
  if (!q.data.length) return <p className="text-sm text-muted-foreground">Every lc-up teacher is linked.</p>;
  return (
    <ul className="space-y-3">
      {q.data.map((person) => (
        <PersonRow key={person.id} person={person} kind="teachers" />
      ))}
    </ul>
  );
}

// ── accounts ─────────────────────────────────────────────────────────────

const CLAIM_BADGE: Record<ClaimState, { variant: BadgeVariant; label: string }> = {
  pending: { variant: "neutral", label: "Not signed in yet" },
  signed_in: { variant: "info", label: "Signed in, choosing a password" },
  done: { variant: "success", label: "Claimed" },
  expired: { variant: "warning", label: "Code expired" },
  locked: { variant: "danger", label: "Locked after 5 tries" },
};

export function AccountsPanel() {
  const q = useLcupAccounts();
  const reissue = useLcupAction((userId: number) => lcupApi.reissue(userId));
  if (q.isLoading) return <Loading />;
  if (q.error || !q.data) return <LoadError error={q.error} onRetry={() => void q.refetch()} />;
  if (!q.data.length) {
    return <p className="text-sm text-muted-foreground">No accounts created yet — they come after the initial review.</p>;
  }
  return (
    <div className="space-y-2">
      <p className="text-sm text-muted-foreground">
        A student signs in with their phone number; the first password is its last 4 digits, for 14 days.
      </p>
      <ActionError error={reissue.error} />
      <ul className="space-y-2">
        {q.data.map((account) => {
          const badge = CLAIM_BADGE[account.state];
          return (
            <li key={account.user.id} className={`${CARD} flex flex-wrap items-center gap-2`}>
              <span className="font-semibold text-foreground">{account.user.name}</span>
              <span className="text-xs text-muted-foreground">{account.phone}</span>
              <Badge variant={badge.variant}>{badge.label}</Badge>
              <span className="text-xs text-muted-foreground">until {when(account.expires_at)}</span>
              {account.state === "expired" || account.state === "locked" ? (
                <Button size="sm" variant="outline" className="ml-auto" disabled={reissue.isPending} onClick={() => reissue.mutate(account.user.id)}>
                  Reissue the code
                </Button>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
