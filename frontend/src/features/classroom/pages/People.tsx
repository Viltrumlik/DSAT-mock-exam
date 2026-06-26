"use client";

import { useState } from "react";
import { Users, UserMinus, GraduationCap, Search } from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import api from "@/lib/api";
import { cn } from "@/lib/cn";
import { normalizeApiError } from "@/lib/apiError";
import { pushGlobalToast } from "@/lib/toastBus";
import { LoadingState, ErrorState, EmptyState, ConfirmDialog } from "../ui";
import { useClassMembers } from "../hooks";
import { classroomKeys } from "../queryKeys";
import { normalizeRole, ROLE_LABEL, capabilitiesFor } from "../capabilities";
import type { ClassroomWithRole, Member } from "../types";

type PendingAction =
  | { kind: "make-ta"; userId: number; name: string }
  | { kind: "revoke-ta"; userId: number; name: string }
  | { kind: "remove"; userId: number; name: string };

const ACTION_COPY: Record<PendingAction["kind"], { title: string; confirmLabel: string; tone: "primary" | "danger"; body: (name: string) => string; toast: (name: string) => string }> = {
  "make-ta": {
    title: "Make teaching assistant?",
    confirmLabel: "Make TA",
    tone: "primary",
    body: (n) => `${n} will gain instructional access — they can create and grade assignments and mark attendance.`,
    toast: (n) => `${n} is now a TA.`,
  },
  "revoke-ta": {
    title: "Revoke teaching assistant?",
    confirmLabel: "Revoke TA",
    tone: "primary",
    body: (n) => `${n} will return to being a regular student and lose instructional access.`,
    toast: (n) => `${n} is no longer a TA.`,
  },
  remove: {
    title: "Remove student?",
    confirmLabel: "Remove",
    tone: "danger",
    body: (n) => `${n} will lose access to this class and its assignments. You can re-add them with the join code.`,
    toast: (n) => `Removed ${n} from the class.`,
  },
};

// Pastel avatar palette — assigned deterministically so a person keeps their color.
const AVATAR_COLORS = [
  "bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300",
  "bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300",
  "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300",
  "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300",
  "bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300",
  "bg-teal-100 text-teal-700 dark:bg-teal-500/15 dark:text-teal-300",
  "bg-indigo-100 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300",
  "bg-pink-100 text-pink-700 dark:bg-pink-500/15 dark:text-pink-300",
  "bg-cyan-100 text-cyan-700 dark:bg-cyan-500/15 dark:text-cyan-300",
  "bg-orange-100 text-orange-700 dark:bg-orange-500/15 dark:text-orange-300",
];
function avatarColor(key: string): string {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

function initials(u: Member["user"]): string {
  const a = (u.first_name?.[0] || u.email?.[0] || "?").toUpperCase();
  const b = (u.last_name?.[0] || "").toUpperCase();
  return b ? `${a}${b}` : a;
}
function fullName(u: Member["user"]): string {
  return [u.first_name, u.last_name].filter(Boolean).join(" ").trim() || u.username || u.email;
}

function useMemberMutation(classId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { userId: number; role?: string; status?: string }) =>
      api.patch(`/classes/${classId}/members/${vars.userId}/`, { role: vars.role, status: vars.status }).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: classroomKeys.members(classId) }),
  });
}

function Avatar({ u, className }: { u: Member["user"]; className?: string }) {
  return (
    <div className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-xs font-bold", avatarColor(u.email || String(u.id)), className)}>
      {initials(u)}
    </div>
  );
}

export function People({ classroom }: { classroom: ClassroomWithRole }) {
  const classId = Number(classroom.id);
  const caps = capabilitiesFor(classroom.my_role);
  const { data, isLoading, isError, refetch } = useClassMembers(classId);
  const mutate = useMemberMutation(classId);
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [query, setQuery] = useState("");

  async function runPending() {
    if (!pending) return;
    const vars =
      pending.kind === "make-ta"
        ? { userId: pending.userId, role: "TA" }
        : pending.kind === "revoke-ta"
          ? { userId: pending.userId, role: "STUDENT" }
          : { userId: pending.userId, status: "REMOVED" };
    try {
      await mutate.mutateAsync(vars);
      pushGlobalToast({ tone: "success", message: ACTION_COPY[pending.kind].toast(pending.name) });
      setPending(null);
    } catch (e) {
      pushGlobalToast({ tone: "error", message: normalizeApiError(e).message });
    }
  }

  const members: Member[] = Array.isArray(data) ? data : data?.members ?? [];
  const active = members.filter((m) => normalizeRole(m.role) != null && String((m as { status?: string }).status ?? "ACTIVE") !== "REMOVED");
  const staff = active.filter((m) => normalizeRole(m.role) !== "STUDENT");
  const students = active.filter((m) => normalizeRole(m.role) === "STUDENT");

  const q = query.trim().toLowerCase();
  const filteredStudents = q
    ? students.filter((m) => fullName(m.user).toLowerCase().includes(q) || (m.user.email ?? "").toLowerCase().includes(q))
    : students;

  if (isLoading) return <LoadingState label="Loading people…" />;
  if (isError) return <ErrorState onRetry={() => refetch()} />;

  // Hover-revealed staff actions for a member card/row.
  const Actions = ({ m }: { m: Member }) => {
    const role = normalizeRole(m.role);
    const uid = m.user.id;
    const busy = mutate.isPending;
    const showMakeTa = caps.canAssignTa && role === "STUDENT";
    const showRevokeTa = caps.canAssignTa && role === "TA";
    const showRemove = caps.canManageRoster && role === "STUDENT";
    if (!showMakeTa && !showRevokeTa && !showRemove) return null;
    return (
      <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
        {showMakeTa && (
          <button type="button" title="Make TA" disabled={busy} onClick={() => setPending({ kind: "make-ta", userId: uid, name: fullName(m.user) })}
            className="rounded-lg p-1.5 text-muted-foreground hover:bg-primary/10 hover:text-primary disabled:opacity-50">
            <GraduationCap className="h-4 w-4" />
          </button>
        )}
        {showRevokeTa && (
          <button type="button" title="Revoke TA" disabled={busy} onClick={() => setPending({ kind: "revoke-ta", userId: uid, name: fullName(m.user) })}
            className="rounded-lg p-1.5 text-muted-foreground hover:bg-surface-2 hover:text-foreground disabled:opacity-50">
            <GraduationCap className="h-4 w-4" />
          </button>
        )}
        {showRemove && (
          <button type="button" title="Remove from class" disabled={busy} onClick={() => setPending({ kind: "remove", userId: uid, name: fullName(m.user) })}
            className="rounded-lg p-1.5 text-muted-foreground hover:bg-rose-500/10 hover:text-rose-600 disabled:opacity-50">
            <UserMinus className="h-4 w-4" />
          </button>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-8">
      {/* Teaching team */}
      <section>
        <div className="mb-3 flex items-center gap-2">
          <GraduationCap className="h-[18px] w-[18px] text-primary" aria-hidden />
          <h2 className="text-base font-bold text-foreground">Teaching team</h2>
          <span className="text-sm text-muted-foreground">{staff.length} {staff.length === 1 ? "member" : "members"}</span>
        </div>
        {staff.length === 0 ? (
          <EmptyState icon={Users} title="No staff yet" />
        ) : (
          <div className="divide-y divide-primary/10 overflow-hidden rounded-2xl border border-primary/15 bg-[var(--primary-soft)]">
            {staff.map((m) => {
              const role = normalizeRole(m.role);
              return (
                <div key={m.id} className="group flex items-center gap-3 px-4 py-3.5">
                  <Avatar u={m.user} className="bg-white text-primary shadow-sm dark:bg-white/90" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-bold text-foreground">{fullName(m.user)}</p>
                    <p className="truncate text-xs text-muted-foreground">{m.user.email}</p>
                  </div>
                  {role && role !== "STUDENT" && (
                    <span className="rounded-full bg-white px-2.5 py-1 text-xs font-bold text-primary shadow-sm dark:bg-white/90">
                      {ROLE_LABEL[role]}
                    </span>
                  )}
                  <Actions m={m} />
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Students */}
      <section>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Users className="h-[18px] w-[18px] text-foreground" aria-hidden />
            <h2 className="text-base font-bold text-foreground">Students</h2>
            <span className="text-sm text-muted-foreground">{students.length} enrolled</span>
          </div>
          {students.length > 0 && (
            <div className="relative w-full max-w-[260px]">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search students"
                className="h-9 w-full rounded-full border border-border bg-card pl-9 pr-3 text-sm text-foreground placeholder:text-muted-foreground/70 focus:border-primary focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
              />
            </div>
          )}
        </div>

        {students.length === 0 ? (
          <EmptyState icon={Users} title="No students yet" description="Share the join code to enroll students." />
        ) : filteredStudents.length === 0 ? (
          <p className="rounded-xl border border-border bg-card px-4 py-8 text-center text-sm text-muted-foreground">
            No students match “{query}”.
          </p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {filteredStudents.map((m) => (
              <div key={m.id} className="group flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3 transition-colors hover:bg-surface-2">
                <Avatar u={m.user} />
                <p className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">{fullName(m.user)}</p>
                <Actions m={m} />
              </div>
            ))}
          </div>
        )}
      </section>

      <ConfirmDialog
        open={pending !== null}
        title={pending ? ACTION_COPY[pending.kind].title : ""}
        description={pending ? ACTION_COPY[pending.kind].body(pending.name) : ""}
        confirmLabel={pending ? ACTION_COPY[pending.kind].confirmLabel : "Confirm"}
        tone={pending ? ACTION_COPY[pending.kind].tone : "primary"}
        loading={mutate.isPending}
        onConfirm={runPending}
        onCancel={() => setPending(null)}
      />
    </div>
  );
}
