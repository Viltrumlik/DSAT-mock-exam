"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, Loader2, Search } from "lucide-react";
import api, { classesApi } from "@/lib/api";
import { cn } from "@/lib/cn";
import { accClass, Avatar } from "./accessUi";

type ClassroomRow = { id: number; name: string };

export type StudentRow = {
  id: number;
  email?: string;
  username?: string;
  first_name?: string;
  last_name?: string;
  role?: string;
};

function label(u: StudentRow): string {
  const name = `${u.first_name ?? ""} ${u.last_name ?? ""}`.trim();
  return name || u.email || u.username || `User #${u.id}`;
}

export function StudentMultiSelect({
  value,
  onChange,
  showClassroomFilter = true,
  onRowsChange,
}: {
  value: number[];
  onChange: (ids: number[]) => void;
  /** Show the "filter by classroom" dropdown. Off for the standalone midterm area,
   *  which grants to individual students with no classroom involved. */
  showClassroomFilter?: boolean;
  /** Reports the full row objects for the currently-selected ids (for the confirm
   *  step's name/avatar display). Best-effort: only rows already loaded are known. */
  onRowsChange?: (rows: StudentRow[]) => void;
}) {
  const [users, setUsers] = useState<StudentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [classrooms, setClassrooms] = useState<ClassroomRow[]>([]);
  const [classroomId, setClassroomId] = useState<number | "">("");
  // Set of student ids in the chosen classroom; null = no classroom filter.
  const [classroomMemberIds, setClassroomMemberIds] = useState<Set<number> | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        // Standalone midterm grant (no classroom filter) → every student system-wide via the
        // teacher endpoint; the classroom/admin usage keeps the scoped /users/ list.
        const endpoint = showClassroomFilter ? "/users/" : "/midterms/teacher/students/";
        const r = await api.get(endpoint);
        const raw: StudentRow[] = Array.isArray(r.data) ? r.data : (r.data?.results ?? []);
        if (alive) setUsers(raw.filter((u) => String(u.role ?? "student").toLowerCase() === "student"));
      } finally {
        if (alive) setLoading(false);
      }
    })();
    if (showClassroomFilter) {
      (async () => {
        try {
          const data = await classesApi.list();
          if (alive) setClassrooms((data.items as ClassroomRow[]) ?? []);
        } catch {
          /* non-fatal */
        }
      })();
    }
    return () => {
      alive = false;
    };
  }, [showClassroomFilter]);

  // When a classroom is picked, fetch its members and restrict the list to those students.
  useEffect(() => {
    let alive = true;
    if (classroomId === "") {
      setClassroomMemberIds(null);
      return;
    }
    (async () => {
      try {
        const r = await api.get(`/classes/${classroomId}/members/`);
        const raw = Array.isArray(r.data) ? r.data : (r.data?.members ?? []);
        const ids = new Set<number>(
          raw
            .filter((m: { role?: string }) => String(m.role ?? "").toUpperCase() === "STUDENT")
            .map((m: { user?: { id?: number } }) => m.user?.id)
            .filter((id: number | undefined): id is number => typeof id === "number"),
        );
        if (alive) setClassroomMemberIds(ids);
      } catch {
        if (alive) setClassroomMemberIds(new Set());
      }
    })();
    return () => {
      alive = false;
    };
  }, [classroomId]);

  const byId = useMemo(() => new Map(users.map((u) => [u.id, u])), [users]);

  // Report loaded row objects for the selected ids (confirm-step display).
  useEffect(() => {
    if (!onRowsChange) return;
    onRowsChange(value.map((id) => byId.get(id)).filter((u): u is StudentRow => Boolean(u)));
  }, [value, byId, onRowsChange]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const scoped = classroomMemberIds ? users.filter((u) => classroomMemberIds.has(u.id)) : users;
    const base = q
      ? scoped.filter((u) =>
          label(u).toLowerCase().includes(q) ||
          (u.email ?? "").toLowerCase().includes(q) ||
          (u.username ?? "").toLowerCase().includes(q),
        )
      : scoped;
    return base.slice(0, 50);
  }, [users, search, classroomMemberIds]);

  const toggle = (id: number) =>
    onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id]);

  return (
    <div className="space-y-3">
      {/* Filters: classroom + search */}
      <div className="flex flex-wrap items-center gap-2">
        {showClassroomFilter && (
          <select
            value={classroomId}
            onChange={(e) => setClassroomId(e.target.value ? Number(e.target.value) : "")}
            className="rounded-xl border border-border bg-card px-3 py-2.5 text-sm font-semibold text-foreground outline-none transition-shadow focus:ring-2 focus:ring-[color:var(--primary)]/25"
          >
            <option value="">All classrooms</option>
            {classrooms.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        )}
        <div className="relative min-w-[220px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search students by name, username, or email…"
            className={accClass.search}
          />
        </div>
      </div>

      {/* Student list */}
      <div className="max-h-[360px] space-y-2 overflow-y-auto pr-1">
        {loading ? (
          <div className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading students…
          </div>
        ) : filtered.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            No students match.
          </p>
        ) : (
          filtered.map((u) => {
            const checked = value.includes(u.id);
            return (
              <button
                type="button"
                key={u.id}
                // Clear the search box after picking a student so the admin can
                // immediately search the next one without manually erasing it.
                onClick={() => { toggle(u.id); setSearch(""); }}
                className={cn(
                  "flex w-full items-center gap-3 px-3.5 py-3 text-left",
                  checked ? accClass.selectableOn : accClass.selectable,
                )}
              >
                <Avatar name={label(u)} seed={u.id} size={40} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-bold text-foreground">{label(u)}</span>
                  {u.email && <span className="block truncate text-xs text-muted-foreground">{u.email}</span>}
                </span>
                <CheckBox checked={checked} />
              </button>
            );
          })
        )}
      </div>

      <div className="flex items-center justify-between text-xs">
        <span className="font-semibold text-muted-foreground">
          <span className="text-foreground">{value.length}</span> selected
        </span>
        {value.length > 0 && (
          <button
            type="button"
            onClick={() => onChange([])}
            className="font-semibold text-muted-foreground transition-colors hover:text-foreground"
          >
            Clear all
          </button>
        )}
      </div>
    </div>
  );
}

/** Mockup checkbox: a rounded square that fills blue with a check when on. */
export function CheckBox({ checked }: { checked: boolean }) {
  return (
    <span
      className={cn(
        "grid h-6 w-6 shrink-0 place-items-center rounded-lg border transition-colors",
        checked ? "border-primary bg-primary text-white" : "border-border bg-card text-transparent",
      )}
      aria-hidden
    >
      <Check className="h-4 w-4" strokeWidth={3} />
    </span>
  );
}
