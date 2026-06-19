"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, Loader2, Search, X } from "lucide-react";
import { accessApi, resourceTypeLabel, HIDDEN_PICKER_TYPES, type ResourcePickerItem } from "@/lib/accessApi";
import { cn } from "@/lib/cn";

export type SelectedResource = { resource_type: string; resource_id: number; label: string };

// Domain subjects come back on each item as "math" / "english".
const SUBJECT_FILTERS: { key: "all" | "math" | "english"; label: string }[] = [
  { key: "all", label: "All subjects" },
  { key: "math", label: "Math" },
  { key: "english", label: "English" },
];

/**
 * Multi-select resource picker: pick several tests at once (many-to-many assignment).
 * Filter by type (dropdown), subject (Math/English), and free text.
 */
export function ResourcePicker({
  value,
  onChange,
}: {
  value: SelectedResource[];
  onChange: (r: SelectedResource[]) => void;
}) {
  const [types, setTypes] = useState<string[]>([]);
  const [type, setType] = useState<string>("");
  const [subject, setSubject] = useState<"all" | "math" | "english">("all");
  const [search, setSearch] = useState("");
  const [items, setItems] = useState<ResourcePickerItem[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    (async () => {
      const t = (await accessApi.resourceTypes()).filter((k) => !HIDDEN_PICKER_TYPES.has(k));
      setTypes(t);
      if (t.length && !type) setType(t.includes("mock_exam") ? "mock_exam" : t[0]);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Debounced search whenever type or query changes.
  useEffect(() => {
    if (!type) return;
    let alive = true;
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const res = await accessApi.searchResources(type, search.trim(), 30);
        if (alive) setItems(res);
      } finally {
        if (alive) setLoading(false);
      }
    }, 250);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [type, search]);

  const selectedKeys = useMemo(
    () => new Set(value.map((v) => `${v.resource_type}:${v.resource_id}`)),
    [value],
  );

  // Subject filter applied client-side on each item's domain subjects.
  const visible = useMemo(() => {
    if (subject === "all") return items;
    return items.filter((it) => (it.subjects ?? []).map((s) => s.toLowerCase()).includes(subject));
  }, [items, subject]);

  const toggle = (it: ResourcePickerItem) => {
    const key = `${it.resource_type}:${it.resource_id}`;
    if (selectedKeys.has(key)) {
      onChange(value.filter((v) => `${v.resource_type}:${v.resource_id}` !== key));
    } else {
      onChange([...value, { resource_type: it.resource_type, resource_id: it.resource_id, label: it.label }]);
    }
  };

  const subjectBadge = (subs: string[]) =>
    subs.map((s) => (
      <span key={s} className="ml-1 rounded bg-surface-2 px-1.5 py-0.5 text-[10px] font-bold uppercase text-muted-foreground">
        {s}
      </span>
    ));

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={type}
          onChange={(e) => setType(e.target.value)}
          className="rounded-xl border border-border bg-card px-3 py-2 text-sm font-semibold text-foreground outline-none focus:ring-2 focus:ring-primary/40"
        >
          {types.map((t) => (
            <option key={t} value={t}>
              {resourceTypeLabel(t)}
            </option>
          ))}
        </select>
        <select
          value={subject}
          onChange={(e) => setSubject(e.target.value as "all" | "math" | "english")}
          className="rounded-xl border border-border bg-card px-3 py-2 text-sm font-semibold text-foreground outline-none focus:ring-2 focus:ring-primary/40"
        >
          {SUBJECT_FILTERS.map((s) => (
            <option key={s.key} value={s.key}>
              {s.label}
            </option>
          ))}
        </select>
        <div className="relative min-w-[200px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by title or id…"
            className="w-full rounded-xl border border-border bg-card py-2 pl-9 pr-3 text-sm text-foreground outline-none focus:ring-2 focus:ring-primary/40"
          />
        </div>
      </div>

      {/* Selected tests (chips) */}
      {value.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {value.map((v) => (
            <span
              key={`${v.resource_type}:${v.resource_id}`}
              className="inline-flex items-center gap-1 rounded-lg bg-primary/10 px-2 py-1 text-xs font-bold text-primary"
            >
              {v.label}
              <button
                type="button"
                aria-label="Remove"
                onClick={() => onChange(value.filter((x) => !(x.resource_type === v.resource_type && x.resource_id === v.resource_id)))}
              >
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

      <div className="max-h-56 overflow-y-auto rounded-xl border border-border bg-card">
        {loading ? (
          <div className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Searching…
          </div>
        ) : visible.length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground">No resources found.</p>
        ) : (
          visible.map((it) => {
            const checked = selectedKeys.has(`${it.resource_type}:${it.resource_id}`);
            return (
              <button
                type="button"
                key={`${it.resource_type}:${it.resource_id}`}
                onClick={() => toggle(it)}
                className={cn(
                  "flex w-full items-center justify-between gap-2 border-b border-border px-3 py-2 text-left text-sm last:border-b-0 hover:bg-surface-2",
                  checked && "bg-primary/5",
                )}
              >
                <span className="min-w-0 truncate">
                  <span className="font-bold text-foreground">{it.label}</span>
                  {subjectBadge(it.subjects)}
                </span>
                <span className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
                  {it.published ? "" : "draft · "}#{it.resource_id}
                  {checked && <Check className="h-4 w-4 text-primary" />}
                </span>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
