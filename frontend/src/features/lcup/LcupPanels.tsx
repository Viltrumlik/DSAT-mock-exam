"use client";

import { useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import Link from "next/link";
import { useQueryClient } from "@tanstack/react-query";
import { classroomKeys } from "@/features/ops/classrooms/classroomsApi";
import { SeatActionDialog } from "@/features/ops/classrooms/sections/SeatDialogs";
import { useOrgClassrooms } from "@/features/org/orgHooks";
import { formatApiErrorForToast } from "@/lib/apiError";
import { cn } from "@/lib/cn";
import { Badge, StatTile, buttonClass, type BadgeTone } from "@/features/console/ui";
import { Pill } from "@/features/ops/people/Fieldset";
import {
  lcupApi,
  type AttendancePushState,
  type ClaimState,
  type GroupLinkStatus,
  type LcupGroup,
  type LcupPerson,
  type LcupPhoneConflict,
  type LcupRef,
  type LcupRun,
  type LcupUserRef,
  type LinkStatus,
  type StudentFilter,
  type TrialState,
} from "./lcupApi";
import {
  lcupKeys,
  useLcupAccounts,
  useLcupArchive,
  useLcupAttendancePushes,
  useLcupAction,
  useLcupFollowups,
  useLcupGroups,
  useLcupStatus,
  useLcupStudents,
  useLcupTeachers,
  useLcupUnlinked,
} from "./lcupHooks";

/**
 * The panels of /ops/lcup. Every write goes through `useLcupAction`, which refetches
 * everything under ["lcup"]: one link moves counts, queues and the classes still free to pair.
 *
 * Drawn like the console's changelists (features/ops/changelist/ChangeList): hairline borders,
 * 13px text, dense rows, statuses as plain words — red only for what went wrong.
 *
 * A failed read renders an error with a retry, never the empty state — "nobody to review" and
 * "the review list did not load" must not look the same on a page whose job is the review.
 */

// ── look ─────────────────────────────────────────────────────────────────
// `cn` does not merge Tailwind classes, so a cell's alignment and colour are never set twice:
// the table carries the colour and `nowrap` (both inherit), a cell only adds what differs.

// The console's look (design handoff v0.3, PR 12b), as Finance has it: cards, hairline tables, 36 px buttons,
// 44 px fields. `relative`, not `overflow-hidden`: a table scrolls in its own `overflow-x-auto`, and a
// positioned sr-only label in a cell must stay inside the box.
const BOX = "relative rounded-ms-card bg-ms-card shadow-ms-1";
const CAPTION_TEXT = "text-ms-over text-ms-fg-3";
const CAPTION = `border-b border-ms-line px-5 py-3 ${CAPTION_TEXT}`;
const TABLE = "w-full border-separate border-spacing-0 whitespace-nowrap text-[14px] text-ms-fg";
const TH_BASE = "h-10 border-b border-ms-border bg-ms-card px-3 text-[13px] font-medium text-ms-fg-3 first:pl-5 last:pr-5";
const TH = `${TH_BASE} text-left`;
const TH_R = `${TH_BASE} text-right`;
const TD = "h-11 border-b border-ms-line px-3 py-1 first:pl-5 last:pr-5";
const TD_R = `${TD} text-right tabular-nums`;
/** A cell whose text may run to a second line (notes, errors, suggestions). */
const TD_WRAP = `${TD} min-w-[12rem] whitespace-normal`;
const TR = "ms-transition hover:bg-ms-surface [&:last-child>td]:border-b-0";
const CONTROL =
  "ms-transition h-9 rounded-ms-ctl border border-ms-border-input bg-ms-card px-3 text-[14px] text-ms-fg outline-none placeholder:text-ms-fg-3 focus:border-ms-primary focus:shadow-[0_0_0_3px_var(--ms-primary-soft-2)]";
const TEXT_BUTTON =
  "rounded-[6px] text-[14px] font-medium text-ms-primary-text hover:underline disabled:cursor-not-allowed disabled:text-ms-fg-disabled disabled:hover:no-underline";

const DAY = ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** The console's 36 px button; `primary` is the one blue button of its row. */
function Btn({ primary, className, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { primary?: boolean }) {
  return <button type="button" {...rest} className={buttonClass({ variant: primary ? "primary" : "secondary", size: "sm", className })} />;
}

function when(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });
}

/** A long list in one cell, cut to the column with the whole of it on hover. */
function Clipped({ text, width = "max-w-[14rem]" }: { text: string; width?: string }) {
  if (!text) return <span className="text-ms-fg-3">—</span>;
  return (
    <span title={text} className={cn("block truncate", width)}>
      {text}
    </span>
  );
}

function Loading() {
  return (
    <div role="status" aria-busy className="flex flex-col gap-3">
      <span className="sr-only">Loading…</span>
      <div className="h-24 animate-ms-shimmer rounded-ms-card bg-ms-surface-2" />
      <div className="h-64 animate-ms-shimmer rounded-ms-card bg-ms-surface-2" />
    </div>
  );
}

function LoadError({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  return (
    <div role="alert" className="rounded-ms-ctl border border-ms-critical-line bg-ms-critical-soft px-4 py-3 text-[14px]">
      <span className="font-semibold text-ms-critical-fg">This list did not load.</span>{" "}
      <span className="text-ms-fg-2">{formatApiErrorForToast(error)}</span>{" "}
      <button type="button" onClick={onRetry} className={TEXT_BUTTON}>
        Retry
      </button>
    </div>
  );
}

function ActionError({ error }: { error: unknown }) {
  if (!error) return null;
  return (
    <p role="alert" className="mt-1 whitespace-normal text-[13px] text-ms-critical-fg">
      {formatApiErrorForToast(error)}
    </p>
  );
}

/** A table in the changelist's frame, scrolling sideways on a narrow screen. */
function DenseTable({ caption, head, children }: { caption: string; head: ReactNode; children: ReactNode }) {
  return (
    <div className={cn(BOX, "overflow-x-auto")}>
      <table className={TABLE}>
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>{head}</tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

// ── status ───────────────────────────────────────────────────────────────

/** One line of a read-only fieldset: the label on the left, the value beside it. */
function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex border-b border-ms-line last:border-b-0">
      <dt className="w-52 shrink-0 px-5 py-2.5 text-ms-fg-3">{label}</dt>
      <dd className="min-w-0 px-3 py-2.5 tabular-nums text-ms-fg">{children}</dd>
    </div>
  );
}

function RunRow({ run }: { run: LcupRun }) {
  const counts = Object.entries(run.counts).filter(([, n]) => n);
  const quiet = !run.alerts.length && !run.errors.length;
  return (
    <tr className={TR}>
      <td className={TD}>{when(run.started_at)}</td>
      <td className={cn(TD, "text-ms-fg-3")}>{run.dry_run ? "Dry run" : "Sync"}</td>
      <td className={TD}>{run.ok ? <Pill tone="positive">OK</Pill> : <Pill tone="critical">Errors</Pill>}</td>
      <td className={cn(TD_WRAP, "text-ms-fg-3")}>
        {counts.length ? counts.map(([key, n]) => `${key.replace(/_/g, " ")}: ${n}`).join(" · ") : "—"}
      </td>
      <td className={cn(TD_WRAP, quiet && "text-ms-fg-3")}>
        {quiet ? "—" : null}
        {run.alerts.map((alert) => (
          <p key={alert}>{alert}</p>
        ))}
        {run.errors.map((err) => (
          <p key={`${err.stage}-${err.error}`} className="text-ms-critical-fg">
            {err.stage}: {err.error}
          </p>
        ))}
      </td>
    </tr>
  );
}

/**
 * A linked learner's phone is lc-up's (owner, 2026-10-28) — except where another account already
 * holds it, since a phone here belongs to one account. Usually siblings on one parent's number, or a
 * second account of the same learner: an admin decides which keeps it.
 */
function PhoneConflicts({ conflicts }: { conflicts: LcupPhoneConflict[] }) {
  if (conflicts.length === 0) return null;
  const person = (p: { id: number; name: string; role?: string }) => (
    <Link href={`/ops/${p.role === "public_student" ? "public" : p.role && p.role !== "student" ? "staff" : "students"}/${p.id}`} prefetch={false} className="text-ms-primary-text hover:underline">
      {p.name}
    </Link>
  );
  return (
    <div className="border-t border-ms-border px-3 py-2">
      <p className="font-medium text-ms-fg">
        lc-up phone already on another account ({conflicts.length})
      </p>
      <p className="text-ms-fg-3">Their name follows lc-up; the phone waits until the other account no longer holds it.</p>
      <ul className="mt-1.5 space-y-1">
        {conflicts.map((c) => (
          <li key={c.user_id}>
            {person({ id: c.user_id, name: c.name, role: c.role })}
            <span className="text-ms-fg-3"> (lc-up: {c.lcup_name}) — held by </span>
            {c.held_by.map((h, i) => (
              <span key={h.id}>
                {i > 0 ? ", " : null}
                {person(h)}
              </span>
            ))}
          </li>
        ))}
      </ul>
    </div>
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
      {/* What waits for an admin, each opening the tab where it is done. */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        {(
          [
            ["Students to review", c.needs_review_students, "students"],
            ["Students with no match", c.unmatched_students, "students"],
            ["Teachers to link", c.needs_review_teachers, "teachers"],
            ["Groups to pair", c.groups_pending, "groups"],
            ["Accounts not claimed yet", c.unclaimed_accounts, "accounts"],
          ] as const
        ).map(([label, n, tab], i) => (
          <StatTile
            key={label}
            label={label}
            value={n}
            tone={n > 0 ? "attention" : "positive"}
            sub={n > 0 ? "open the list" : "nothing waiting"}
            href={`/ops/lcup?tab=${tab}`}
            delay={i * 30}
          />
        ))}
      </div>

      <section aria-label="Status" className={cn(BOX, "text-[14px]")}>
        <div className="flex flex-wrap items-center gap-2 border-b border-ms-line px-5 py-3">
          <h2 className={CAPTION_TEXT}>Status</h2>
          {status.enabled ? (
            <Badge tone="positive" dot>
              Sync on
            </Badge>
          ) : (
            <Badge tone="neutral">Sync off</Badge>
          )}
          <div className="ml-auto flex gap-2">
            <Btn disabled={sync.isPending} onClick={() => sync.mutate(true)}>
              Dry run
            </Btn>
            <Btn primary disabled={!status.enabled || sync.isPending} onClick={() => sync.mutate(false)}>
              Sync now
            </Btn>
          </div>
        </div>
        <dl>
          <Field label="Sync">{status.enabled ? "On" : "Off"}</Field>
          <Field label="Initial review">
            {status.initial_review_done_at ? `Done ${when(status.initial_review_done_at)}` : "Not done yet"}
          </Field>
        </dl>
        <PhoneConflicts conflicts={status.phone_conflicts ?? []} />
        {sync.isSuccess || sync.error ? (
          <div className="border-t border-ms-border px-3 py-2">
            {sync.isSuccess ? (
              <p className="text-ms-fg-3">Queued — the run appears below when the worker finishes it.</p>
            ) : null}
            <ActionError error={sync.error} />
          </div>
        ) : null}
      </section>

      <section aria-label="Initial review" className={cn(BOX, "text-[13px]")}>
        <h2 className={CAPTION}>Initial review</h2>
        <div className="space-y-2 px-3 py-2">
          <p className="text-ms-fg-3">
            Until this is marked done, the sync only links and suggests. Once every student who already has an account
            is linked, mark it done: from the next sync, accounts are created for the rest, and classes for groups that
            match none of ours.
          </p>
          <div className="flex flex-wrap gap-2">
            {confirming ? (
              <>
                <Btn
                  primary
                  disabled={done.isPending}
                  onClick={() => done.mutate(undefined, { onSuccess: () => setConfirming(false) })}
                >
                  Yes, mark it done
                </Btn>
                <Btn onClick={() => setConfirming(false)}>Cancel</Btn>
              </>
            ) : (
              <Btn
                disabled={Boolean(status.initial_review_done_at) || c.needs_review_students > 0}
                onClick={() => setConfirming(true)}
              >
                Mark initial review done
              </Btn>
            )}
          </div>
          <ActionError error={done.error} />
        </div>
      </section>

      <section aria-label="Recent runs" className="space-y-2">
        <h2 className={CAPTION_TEXT}>Recent runs</h2>
        {status.recent_runs.length ? (
          <DenseTable
            caption="Recent sync runs"
            head={
              <>
                <th scope="col" className={TH}>Started</th>
                <th scope="col" className={TH}>Kind</th>
                <th scope="col" className={TH}>Result</th>
                <th scope="col" className={TH}>Changes</th>
                <th scope="col" className={TH}>Alerts and errors</th>
              </>
            }
          >
            {status.recent_runs.map((run) => (
              <RunRow key={run.id} run={run} />
            ))}
          </DenseTable>
        ) : (
          <p className="text-[13px] text-ms-fg-3">No sync has run yet. A dry run shows what the first one would do.</p>
        )}
      </section>
    </div>
  );
}

// ── groups ───────────────────────────────────────────────────────────────

const GROUP_STATUS: Record<GroupLinkStatus, string> = {
  suggested: "To pair",
  needs_teacher: "Link its teacher first",
  confirmed: "Paired",
  ignored: "Ignored",
};

const GROUP_ORDER: Record<GroupLinkStatus, number> = { suggested: 0, needs_teacher: 1, confirmed: 2, ignored: 3 };

/** Each status word in the tone of what it asks: amber is work to do, green settled, grey set aside. */
const GROUP_TONE: Record<GroupLinkStatus, BadgeTone> = { suggested: "attention", needs_teacher: "attention", confirmed: "positive", ignored: "neutral" };
const LINK_TONE: Record<LinkStatus, BadgeTone> = {
  auto: "positive", confirmed: "positive", created: "info", needs_review: "attention", unmatched: "critical", ignored: "neutral",
};
const CLAIM_TONE: Record<ClaimState, BadgeTone> = { pending: "neutral", signed_in: "info", done: "positive", expired: "attention", locked: "critical" };
const PUSH_TONE: Record<AttendancePushState, BadgeTone> = { sent: "positive", failed: "attention", refused: "critical" };

function GroupRow({ group, freeRooms }: { group: LcupGroup; freeRooms: { id: number; name: string }[] }) {
  const [choice, setChoice] = useState(group.suggestion ? String(group.suggestion.id) : "");
  const confirm = useLcupAction((classroomId: number | undefined) => lcupApi.confirmGroup(group.id, classroomId));
  const create = useLcupAction(() => lcupApi.createClass(group.id));
  const ignore = useLcupAction(() => lcupApi.ignoreGroup(group.id));
  const open = !group.deleted && group.status !== "confirmed" && group.status !== "ignored";
  const busy = confirm.isPending || create.isPending || ignore.isPending;
  const days = group.days.map((d) => DAY[d] ?? d).join("/");
  const time = group.start_time ? `${group.start_time}–${group.finish_time}` : "";
  const schedule = [days, time].filter(Boolean).join(" ");
  const error = confirm.error || create.error || ignore.error;

  return (
    <tr className={TR}>
      <td className={TD}>
        <span className="font-medium">{group.name}</span>
        {group.deleted ? <span className="ml-2 text-[12px] text-ms-critical-fg">Deleted in lc-up</span> : null}
      </td>
      <td className={cn(TD, "text-ms-fg-3")}>{group.course || "—"}</td>
      <td className={cn(TD, "text-ms-fg-3")}>{schedule || "—"}</td>
      <td className={cn(TD, "text-ms-fg-3")}>
        <Clipped text={group.teachers.join(", ")} width="max-w-[11rem]" />
      </td>
      <td className={TD_R}>{group.member_count ?? "—"}</td>
      <td className={TD}>
        <Pill tone={GROUP_TONE[group.status]}>{GROUP_STATUS[group.status]}</Pill>
      </td>
      <td className={TD_WRAP}>
        {group.classroom ? (
          group.classroom.name
        ) : group.suggestion ? (
          <>
            Suggested: <span className="font-medium">{group.suggestion.name}</span> ({group.suggestion.score}/14)
            {group.suggestion.reasons.length ? (
              <span className="block text-[12px] text-ms-fg-3">{group.suggestion.reasons.join(", ")}</span>
            ) : null}
          </>
        ) : group.notes.length ? null : (
          <span className="text-ms-fg-3">—</span>
        )}
        {group.notes.map((note) => (
          <span key={note} className="block text-[12px] text-ms-fg-3">
            {note}
          </span>
        ))}
      </td>
      <td className={TD}>
        {open ? (
          <div className="flex items-center gap-1.5">
            <select
              aria-label={`Class for ${group.name}`}
              value={choice}
              onChange={(e) => setChoice(e.target.value)}
              className={cn(CONTROL, "w-48")}
            >
              <option value="">Choose a class…</option>
              {group.suggestion && !freeRooms.some((r) => r.id === group.suggestion!.id) ? (
                <option value={group.suggestion.id}>{group.suggestion.name}</option>
              ) : null}
              {freeRooms.map((room) => (
                <option key={room.id} value={room.id}>
                  {room.name}
                </option>
              ))}
            </select>
            <Btn primary disabled={busy || !choice} onClick={() => confirm.mutate(Number(choice))}>
              Pair
            </Btn>
            <Btn disabled={busy} onClick={() => create.mutate(undefined)}>
              Create a new class
            </Btn>
            <button type="button" className={cn(TEXT_BUTTON, "px-1")} disabled={busy} onClick={() => ignore.mutate(undefined)}>
              Ignore
            </button>
          </div>
        ) : null}
        <ActionError error={error} />
      </td>
    </tr>
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
    return <p className="text-[13px] text-ms-fg-3">No lc-up groups yet. They appear after the first sync.</p>;
  }
  return (
    <div className="space-y-2">
      {rooms.error ? (
        <p role="alert" className="text-[12px] text-ms-critical-fg">
          Our class list did not load, so only suggested classes can be chosen.
        </p>
      ) : null}
      <p className="text-[13px] tabular-nums text-ms-fg-3">
        {groups.length} {groups.length === 1 ? "group" : "groups"}
      </p>
      <DenseTable
        caption="lc-up groups and the classes they are paired with"
        head={
          <>
            <th scope="col" className={TH}>Group</th>
            <th scope="col" className={TH}>Course</th>
            <th scope="col" className={TH}>Schedule</th>
            <th scope="col" className={TH}>Teachers</th>
            <th scope="col" className={TH_R}>In lc-up</th>
            <th scope="col" className={TH}>Status</th>
            <th scope="col" className={TH}>Class</th>
            <th scope="col" className={TH}>
              <span className="sr-only">Actions</span>
            </th>
          </>
        }
      >
        {groups.map((group) => (
          <GroupRow key={group.id} group={group} freeRooms={freeRooms} />
        ))}
      </DenseTable>
    </div>
  );
}

// ── students and teachers ────────────────────────────────────────────────

const LINK_STATUS: Record<LinkStatus, string> = {
  auto: "Auto-linked",
  confirmed: "Linked",
  created: "Account created",
  needs_review: "Needs review",
  unmatched: "No match",
  ignored: "Ignored",
};

function PersonRow({ person, kind }: { person: LcupPerson; kind: "students" | "teachers" }) {
  const [accountId, setAccountId] = useState("");
  const [phone, setPhone] = useState("");
  const link = useLcupAction((userId: number) =>
    kind === "students" ? lcupApi.linkStudent(person.id, userId) : lcupApi.linkTeacher(person.id, userId),
  );
  const ignore = useLcupAction(() => (kind === "students" ? lcupApi.ignoreStudent(person.id) : lcupApi.ignoreTeacher(person.id)));
  const create = useLcupAction((otherPhone: string) => lcupApi.createAccount(person.id, otherPhone || undefined));
  const busy = link.isPending || ignore.isPending || create.isPending;

  return (
    <tr className={TR}>
      <td className={cn(TD, "font-medium")}>{person.name}</td>
      <td className={cn(TD, !person.phone && "text-ms-fg-3")}>{person.phone || "no phone in lc-up"}</td>
      <td className={cn(TD, "text-ms-fg-3")}>
        <Clipped text={person.groups.join(", ")} />
      </td>
      <td className={TD}>
        <Pill tone={LINK_TONE[person.status]}>{LINK_STATUS[person.status]}</Pill>
      </td>
      <td className={cn(TD_WRAP, "text-ms-fg-3")}>{person.reason || "—"}</td>
      <td className={cn(TD, !person.user && "text-ms-fg-3")}>
        {person.user ? `${person.user.name} (${person.user.username})` : "—"}
      </td>
      <td className={TD}>
        {person.candidates.length ? (
          <ul className="space-y-0.5">
            {person.candidates.map((candidate) => (
              <li key={candidate.user_id} className="flex items-center gap-2">
                <span>{candidate.name}</span>
                <span className="text-[12px] text-ms-fg-3">{candidate.reason}</span>
                <button
                  type="button"
                  className={TEXT_BUTTON}
                  disabled={busy}
                  aria-label={`Link to ${candidate.name}`}
                  onClick={() => link.mutate(candidate.user_id)}
                >
                  Link
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <span className="text-ms-fg-3">—</span>
        )}
      </td>
      <td className={TD}>
        <div className="flex items-center gap-1.5">
          <input
            aria-label="Account ID"
            placeholder="Account ID"
            inputMode="numeric"
            value={accountId}
            onChange={(e) => setAccountId(e.target.value.replace(/\D/g, ""))}
            className={cn(CONTROL, "w-24")}
          />
          <Btn disabled={busy || !accountId} onClick={() => link.mutate(Number(accountId))}>
            Link to this account
          </Btn>
          {kind === "students" && !person.user ? (
            <>
              <input
                aria-label="Another phone"
                placeholder="Another phone (siblings)"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className={cn(CONTROL, "ml-2 w-44")}
              />
              <Btn primary disabled={busy} onClick={() => create.mutate(phone)}>
                Create account
              </Btn>
            </>
          ) : null}
          <button type="button" className={cn(TEXT_BUTTON, "ml-1 px-1")} disabled={busy} onClick={() => ignore.mutate(undefined)}>
            Ignore
          </button>
        </div>
        <ActionError error={link.error || ignore.error || create.error} />
      </td>
    </tr>
  );
}

function PeopleTable({ people, kind }: { people: LcupPerson[]; kind: "students" | "teachers" }) {
  return (
    <DenseTable
      caption={kind === "students" ? "lc-up students" : "lc-up teachers"}
      head={
        <>
          <th scope="col" className={TH}>Name</th>
          <th scope="col" className={TH}>Phone</th>
          <th scope="col" className={TH}>Groups</th>
          <th scope="col" className={TH}>Status</th>
          <th scope="col" className={TH}>Note</th>
          <th scope="col" className={TH}>Linked to</th>
          <th scope="col" className={TH}>Possible matches</th>
          <th scope="col" className={TH}>
            <span className="sr-only">Actions</span>
          </th>
        </>
      }
    >
      {people.map((person) => (
        <PersonRow key={person.id} person={person} kind={kind} />
      ))}
    </DenseTable>
  );
}

function UnlinkedMembers() {
  const q = useLcupUnlinked();
  if (q.isLoading) return <Loading />;
  if (q.error || !q.data) return <LoadError error={q.error} onRetry={() => void q.refetch()} />;
  if (!q.data.length) {
    return <p className="text-[13px] text-ms-fg-3">Every student of a paired class is linked to lc-up.</p>;
  }
  return (
    <DenseTable
      caption="Students in paired classes who are not linked to lc-up"
      head={
        <>
          <th scope="col" className={TH}>Student</th>
          <th scope="col" className={TH}>Class</th>
          <th scope="col" className={TH_R}>Account ID</th>
        </>
      }
    >
      {q.data.map((row) => (
        <tr key={`${row.classroom.id}-${row.user.id}`} className={TR}>
          <td className={TD}>{row.user.name}</td>
          <td className={cn(TD, "text-ms-fg-3")}>{row.classroom.name}</td>
          <td className={TD_R}>{row.user.id}</td>
        </tr>
      ))}
    </DenseTable>
  );
}

export function StudentsPanel() {
  const [filter, setFilter] = useState<StudentFilter>("needs_review");
  const q = useLcupStudents(filter);

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2 text-[13px]">
          <label className="flex items-center gap-2 text-ms-fg-3">
            Show
            <select
              aria-label="Which students"
              value={filter}
              onChange={(e) => setFilter(e.target.value as StudentFilter)}
              className={CONTROL}
            >
              <option value="needs_review">Needs review</option>
              <option value="unmatched">No match yet</option>
              <option value="all">Everyone in a live group</option>
            </select>
          </label>
          {q.data ? (
            <span className="tabular-nums text-ms-fg-3">
              {q.data.length} {q.data.length === 1 ? "student" : "students"}
            </span>
          ) : null}
        </div>
        {q.isLoading ? (
          <Loading />
        ) : q.error || !q.data ? (
          <LoadError error={q.error} onRetry={() => void q.refetch()} />
        ) : q.data.length ? (
          <PeopleTable people={q.data} kind="students" />
        ) : (
          <p className="text-[13px] text-ms-fg-3">Nobody here.</p>
        )}
      </div>

      <section aria-label="In our paired classes, but not linked to lc-up" className="space-y-2">
        <h2 className={CAPTION_TEXT}>In our paired classes, but not linked to lc-up</h2>
        <p className="text-[12px] text-ms-fg-3">
          The sync never removes these students. Link each one to their lc-up record above, or leave them if they are
          not lc-up students.
        </p>
        <UnlinkedMembers />
      </section>
    </div>
  );
}

export function TeachersPanel() {
  const q = useLcupTeachers();
  if (q.isLoading) return <Loading />;
  if (q.error || !q.data) return <LoadError error={q.error} onRetry={() => void q.refetch()} />;
  if (!q.data.length) return <p className="text-[13px] text-ms-fg-3">Every lc-up teacher is linked.</p>;
  return <PeopleTable people={q.data} kind="teachers" />;
}

// ── accounts ─────────────────────────────────────────────────────────────

const CLAIM_STATE: Record<ClaimState, string> = {
  pending: "Not signed in yet",
  signed_in: "Signed in, choosing a password",
  done: "Claimed",
  expired: "Code expired",
  locked: "Locked after 5 tries",
};

export function AccountsPanel() {
  const q = useLcupAccounts();
  const reissue = useLcupAction((userId: number) => lcupApi.reissue(userId));
  if (q.isLoading) return <Loading />;
  if (q.error || !q.data) return <LoadError error={q.error} onRetry={() => void q.refetch()} />;
  if (!q.data.length) {
    return <p className="text-[13px] text-ms-fg-3">No accounts created yet — they come after the initial review.</p>;
  }
  return (
    <div className="space-y-2">
      <p className="text-[13px] text-ms-fg-3">
        A student signs in with their phone number; the first password is its last 4 digits, for 14 days.
      </p>
      <ActionError error={reissue.error} />
      <DenseTable
        caption="Accounts created from lc-up"
        head={
          <>
            <th scope="col" className={TH}>Student</th>
            <th scope="col" className={TH}>Phone</th>
            <th scope="col" className={TH}>State</th>
            <th scope="col" className={TH}>Valid until</th>
            <th scope="col" className={TH_R}>
              <span className="sr-only">Action</span>
            </th>
          </>
        }
      >
        {q.data.map((account) => {
          const stuck = account.state === "expired" || account.state === "locked";
          return (
            <tr key={account.user.id} className={TR}>
              <td className={cn(TD, "font-medium")}>{account.user.name}</td>
              <td className={TD}>{account.phone}</td>
              <td className={TD}>
                <Pill tone={CLAIM_TONE[account.state]}>{CLAIM_STATE[account.state]}</Pill>
              </td>
              <td className={cn(TD, "text-ms-fg-3")}>{when(account.expires_at)}</td>
              <td className={cn(TD, "text-right")}>
                {stuck ? (
                  <Btn disabled={reissue.isPending} onClick={() => reissue.mutate(account.user.id)}>
                    Reissue the code
                  </Btn>
                ) : null}
              </td>
            </tr>
          );
        })}
      </DenseTable>
    </div>
  );
}

// ── attendance ───────────────────────────────────────────────────────────

const PUSH_STATE: Record<AttendancePushState, string> = {
  sent: "Sent",
  failed: "Will retry",
  refused: "Refused by lc-up",
};

/** What was sent to lc-up — once per register, when it closes — and what lc-up did not take. */
export function AttendancePushesPanel() {
  const q = useLcupAttendancePushes();
  if (q.isLoading) return <Loading />;
  if (q.error || !q.data) return <LoadError error={q.error} onRetry={() => void q.refetch()} />;
  if (!q.data.length) {
    return (
      <p className="text-[13px] text-ms-fg-3">
        Nothing sent to lc-up yet. A register is sent once it closes — two hours after its lesson — and only the marks
        lc-up does not already have.
      </p>
    );
  }
  return (
    <DenseTable
      caption="Registers sent to lc-up"
      head={
        <>
          <th scope="col" className={TH}>Group</th>
          <th scope="col" className={TH}>Lesson</th>
          <th scope="col" className={TH}>State</th>
          <th scope="col" className={TH}>Marks</th>
          <th scope="col" className={TH}>Not taken by lc-up, or not sent</th>
        </>
      }
    >
      {q.data.map((push) => {
        const quiet = !push.error && !push.failures.length;
        return (
          <tr key={push.id} className={TR}>
            <td className={cn(TD, "font-medium")}>{push.group}</td>
            <td className={TD}>{push.date}</td>
            <td className={TD}>
              <Pill tone={PUSH_TONE[push.state]}>{PUSH_STATE[push.state]}</Pill>
            </td>
            <td className={cn(TD, "tabular-nums")}>
              {push.marks} mark{push.marks === 1 ? "" : "s"}
              {push.summary.saved != null ? ` · ${push.summary.saved} saved` : ""}
            </td>
            <td className={cn(TD_WRAP, quiet && "text-ms-fg-3")}>
              {quiet ? "—" : null}
              {push.error ? <p className="text-[12px] text-ms-fg-3">{push.error}</p> : null}
              {push.failures.map((failure, index) =>
                failure.code === "no_account" ? (
                  <p key={`${push.id}-${index}`} className="text-ms-critical-fg">
                    {failure.name || "A student"} — no account here, so not sent: mark them in lc-up by hand
                  </p>
                ) : (
                  <p key={`${push.id}-${index}`}>
                    {failure.student?.name ?? "A student"} — lc-up did not take this mark ({failure.code || "unknown"})
                  </p>
                ),
              )}
            </td>
          </tr>
        );
      })}
    </DenseTable>
  );
}

// ── archive ──────────────────────────────────────────────────────────────

/** A run's errors and alerts, or what it took in: "new" and "changed" summed over every kind of record. */
function archiveRunNote(run: { counts: Record<string, Record<string, number>>; errors: string[]; alerts: string[] }) {
  if (run.errors.length) return run.errors.join(" · ");
  const sum = (key: string) => Object.values(run.counts).reduce((n, c) => n + (c[key] ?? 0), 0);
  const note = `${sum("new")} new · ${sum("changed")} changed · ${sum("gone")} gone`;
  return run.alerts.length ? `${note} · ${run.alerts.join(" · ")}` : note;
}

/**
 * The copy of everything lc-up's API serves, kept for the day the centre leaves it. Read-only: the
 * archive never writes to lc-up, and this panel shows counts, never the records (phones, balances).
 */
export function ArchivePanel() {
  const q = useLcupArchive();
  if (q.isLoading) return <Loading />;
  if (q.error || !q.data) return <LoadError error={q.error} onRetry={() => void q.refetch()} />;
  const { entities, backfill, runs, enabled, since } = q.data;
  const held = entities.reduce((n, e) => n + e.total, 0);
  return (
    <div className="space-y-3">
      <p className="text-[13px] text-ms-fg-3">
        {enabled ? "Copied every night at 03:05" : "The nightly copy is off (LCUP_ARCHIVE_ENABLED)"} — attendance and
        payments from {since}.{" "}
        {Object.entries(backfill)
          .map(([entity, b]) => `${entity}: ${b.done} of ${b.total} older windows done`)
          .join(" · ")}
      </p>
      {held === 0 ? (
        <p className="text-[13px] text-ms-fg-3">Nothing copied from lc-up yet.</p>
      ) : (
        <DenseTable
          caption="lc-up records held"
          head={
            <>
              <th scope="col" className={TH}>Record</th>
              <th scope="col" className={TH_R}>Held</th>
              <th scope="col" className={TH_R}>No longer in lc-up</th>
              <th scope="col" className={TH_R}>Versions</th>
              <th scope="col" className={TH}>Dates</th>
              <th scope="col" className={TH}>Last seen</th>
            </>
          }
        >
          {entities.map((e) => (
            <tr key={e.entity} className={TR}>
              <td className={cn(TD, "font-medium")}>{e.label}</td>
              <td className={TD_R}>{e.total}</td>
              <td className={cn(TD_R, !e.gone && "text-ms-fg-3")}>{e.gone}</td>
              <td className={TD_R}>{e.versions}</td>
              <td className={cn(TD, !e.first_day && "text-ms-fg-3")}>
                {e.first_day ? `${e.first_day} – ${e.last_day}` : "—"}
              </td>
              <td className={TD}>{when(e.last_seen_at)}</td>
            </tr>
          ))}
        </DenseTable>
      )}
      {runs.length ? (
        <DenseTable
          caption="Archive runs"
          head={
            <>
              <th scope="col" className={TH}>Started</th>
              <th scope="col" className={TH}>Result</th>
              <th scope="col" className={TH}>What it took in</th>
            </>
          }
        >
          {runs.map((run) => (
            <tr key={run.id} className={TR}>
              <td className={TD}>{when(run.started_at)}</td>
              <td className={TD}>
                <Pill tone={run.ok ? "positive" : "critical"}>{run.ok ? "OK" : "Failed"}</Pill>
                {run.dry_run ? <span className="text-ms-fg-3"> (dry run)</span> : ""}
              </td>
              <td className={cn(TD_WRAP, run.ok && "text-ms-fg-3")}>{archiveRunNote(run)}</td>
            </tr>
          ))}
        </DenseTable>
      ) : null}
    </div>
  );
}

// ── trials ───────────────────────────────────────────────────────────────

const TRIAL_STATE: Record<TrialState, { label: string; tone: string }> = {
  used: { label: "Came after the free lesson", tone: "font-semibold text-amber-700 dark:text-amber-300" },
  came: { label: "Came to trial", tone: "font-semibold text-sky-700 dark:text-sky-300" },
  not_yet: { label: "Not come yet", tone: "text-ms-fg-3" },
};

const PERSON_LINK = "text-ms-primary-text hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ms-ring";

/**
 * Trial students, neediest first. While lc-up runs they are activated there and leave within one sync; once it is
 * off (`seats_open`) an admin activates or removes them here.
 */
export function TrialStudentsPanel() {
  const q = useLcupFollowups();
  const qc = useQueryClient();
  const [asking, setAsking] = useState<{ action: "activate" | "leave"; room: LcupRef; student: LcupUserRef; name: string } | null>(null);
  if (q.isLoading) return <Loading />;
  if (q.error || !q.data) return <LoadError error={q.error} onRetry={() => void q.refetch()} />;
  const open = q.data.seats_open ?? false;
  if (!q.data.trials.length) {
    return (
      <p className="text-[13px] text-ms-fg-3">
        {open ? "No one is on trial right now." : "No one is on trial in lc-up right now."}
      </p>
    );
  }
  return (
    <>
      <DenseTable
        caption="Trial students"
        head={
          <>
            <th scope="col" className={TH}>Student</th>
            <th scope="col" className={TH}>Class</th>
            <th scope="col" className={TH}>Teacher</th>
            <th scope="col" className={TH}>Trial since</th>
            <th scope="col" className={TH_R}>Lessons came</th>
            <th scope="col" className={TH}>Status</th>
            {open ? <th scope="col" className={TH} aria-label="Actions" /> : null}
          </>
        }
      >
        {q.data.trials.map((row) => (
          <tr key={row.membership_id} className={TR}>
            <td className={cn(TD, "font-medium")}>
              {row.student ? <Link href={`/ops/students/${row.student.id}`} className={PERSON_LINK}>{row.name}</Link> : row.name}
            </td>
            <td className={TD}>{row.classroom.name}</td>
            <td className={TD}>{row.teachers.join(", ") || "—"}</td>
            <td className={TD}>{row.since ?? "—"}</td>
            <td className={TD_R}>{row.lessons}</td>
            <td className={cn(TD, TRIAL_STATE[row.state].tone)}>
              {TRIAL_STATE[row.state].label}
              {row.state === "came" && row.first_lesson ? ` (${row.first_lesson})` : ""}
            </td>
            {open ? (
              <td className={TD}>
                {row.student ? (
                  <span className="flex justify-end gap-1.5">
                    <Btn primary onClick={() => setAsking({ action: "activate", room: row.classroom, student: row.student!, name: row.name })}>
                      Activate
                    </Btn>
                    <Btn onClick={() => setAsking({ action: "leave", room: row.classroom, student: row.student!, name: row.name })}>
                      Remove
                    </Btn>
                  </span>
                ) : null}
              </td>
            ) : null}
          </tr>
        ))}
      </DenseTable>
      {asking ? (
        <SeatActionDialog
          roomId={asking.room.id}
          student={{ id: asking.student.id, name: asking.name }}
          action={asking.action}
          trial
          words={asking.action === "leave" ? { title: `Remove ${asking.name} from ${asking.room.name}?`, confirm: "Remove" } : undefined}
          onClose={() => setAsking(null)}
          onDone={() => {
            setAsking(null);
            void qc.invalidateQueries({ queryKey: lcupKeys.followups });
            void qc.invalidateQueries({ queryKey: classroomKeys.all });
          }}
        />
      ) : null}
    </>
  );
}

/** lc-up members of a paired group that no class list shows — their teacher cannot mark them. */
export function NotOnListPanel() {
  const q = useLcupFollowups();
  if (q.isLoading) return <Loading />;
  if (q.error || !q.data) return <LoadError error={q.error} onRetry={() => void q.refetch()} />;
  if (!q.data.not_on_list.length) {
    return <p className="text-[13px] text-ms-fg-3">Every lc-up member of a paired group is on their class list.</p>;
  }
  return (
    <DenseTable
      caption="lc-up members not on their class list"
      head={
        <>
          <th scope="col" className={TH}>Student</th>
          <th scope="col" className={TH}>Class</th>
          <th scope="col" className={TH}>lc-up status</th>
          <th scope="col" className={TH}>Member since</th>
          <th scope="col" className={TH}>Why</th>
        </>
      }
    >
      {q.data.not_on_list.map((row) => (
        <tr key={`${row.lcup_student_id}-${row.classroom.id}`} className={TR}>
          <td className={cn(TD, "font-medium")}>
            {row.student ? <Link href={`/ops/students/${row.student.id}`} className={PERSON_LINK}>{row.name}</Link> : row.name}
            {row.phone ? <span className="ml-2 text-[12px] font-normal text-ms-fg-3">{row.phone}</span> : null}
          </td>
          <td className={TD}>{row.classroom.name}</td>
          <td className={TD}>{row.lcup_status}</td>
          <td className={TD}>{row.since ?? "—"}</td>
          <td className={TD_WRAP}>
            {row.reason_text}
            {row.reason === "needs_review" || row.reason === "ignored" ? (
              <>
                {" "}
                <Link href="/ops/lcup" className={PERSON_LINK}>Open lc-up</Link>
              </>
            ) : null}
          </td>
        </tr>
      ))}
    </DenseTable>
  );
}
