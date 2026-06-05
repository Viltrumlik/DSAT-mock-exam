"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2, Search, X } from "lucide-react";
import api from "@/lib/api";
import { cn } from "@/lib/cn";

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
}: {
  value: number[];
  onChange: (ids: number[]) => void;
}) {
  const [users, setUsers] = useState<StudentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await api.get("/users/");
        const raw: StudentRow[] = Array.isArray(r.data) ? r.data : (r.data?.results ?? []);
        if (alive) setUsers(raw.filter((u) => String(u.role ?? "student").toLowerCase() === "student"));
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const byId = useMemo(() => new Map(users.map((u) => [u.id, u])), [users]);
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const base = q
      ? users.filter((u) =>
          label(u).toLowerCase().includes(q) ||
          (u.email ?? "").toLowerCase().includes(q) ||
          (u.username ?? "").toLowerCase().includes(q),
        )
      : users;
    return base.slice(0, 50);
  }, [users, search]);

  const toggle = (id: number) =>
    onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id]);

  return (
    <div className="space-y-2">
      {/* Selected chips */}
      {value.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {value.map((id) => (
            <span
              key={id}
              className="inline-flex items-center gap-1 rounded-lg bg-primary/10 px-2 py-1 text-xs font-bold text-primary"
            >
              {byId.has(id) ? label(byId.get(id)!) : `#${id}`}
              <button type="button" onClick={() => toggle(id)} aria-label="Remove">
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
          <button
            type="button"
            onClick={() => onChange([])}
            className="text-xs font-semibold text-muted-foreground hover:text-foreground"
          >
            Clear all
          </button>
        </div>
      )}

      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search students by name, username, or email…"
          className="w-full rounded-xl border border-border bg-card py-2 pl-9 pr-3 text-sm text-foreground outline-none focus:ring-2 focus:ring-primary/40"
        />
      </div>

      <div className="max-h-56 overflow-y-auto rounded-xl border border-border bg-card">
        {loading ? (
          <div className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading students…
          </div>
        ) : filtered.length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground">No students match.</p>
        ) : (
          filtered.map((u) => {
            const checked = value.includes(u.id);
            return (
              <button
                type="button"
                key={u.id}
                onClick={() => toggle(u.id)}
                className={cn(
                  "flex w-full items-center justify-between gap-2 border-b border-border px-3 py-2 text-left text-sm last:border-b-0 hover:bg-surface-2",
                  checked && "bg-primary/5",
                )}
              >
                <span className="min-w-0 truncate">
                  <span className="font-bold text-foreground">{label(u)}</span>
                  {u.email && <span className="ml-2 text-xs text-muted-foreground">{u.email}</span>}
                </span>
                <input type="checkbox" readOnly checked={checked} className="h-4 w-4 accent-[var(--primary)]" />
              </button>
            );
          })
        )}
      </div>
      <p className="text-xs text-muted-foreground">{value.length} selected</p>
    </div>
  );
}
