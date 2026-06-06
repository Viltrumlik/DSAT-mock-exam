"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2, Search } from "lucide-react";
import { accessApi, resourceTypeLabel, HIDDEN_PICKER_TYPES, type ResourcePickerItem } from "@/lib/accessApi";
import { cn } from "@/lib/cn";

export type SelectedResource = { resource_type: string; resource_id: number; label: string };

export function ResourcePicker({
  value,
  onChange,
}: {
  value: SelectedResource | null;
  onChange: (r: SelectedResource | null) => void;
}) {
  const [types, setTypes] = useState<string[]>([]);
  const [type, setType] = useState<string>("");
  const [search, setSearch] = useState("");
  const [items, setItems] = useState<ResourcePickerItem[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    (async () => {
      const t = (await accessApi.resourceTypes()).filter((k) => !HIDDEN_PICKER_TYPES.has(k));
      setTypes(t);
      if (t.length && !type) setType(t.includes("practice_test") ? "practice_test" : t[0]);
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

  const subjectBadge = useMemo(
    () => (subs: string[]) =>
      subs.map((s) => (
        <span key={s} className="ml-1 rounded bg-surface-2 px-1.5 py-0.5 text-[10px] font-bold uppercase text-muted-foreground">
          {s}
        </span>
      )),
    [],
  );

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={type}
          onChange={(e) => {
            setType(e.target.value);
            onChange(null);
          }}
          className="rounded-xl border border-border bg-card px-3 py-2 text-sm font-semibold text-foreground outline-none focus:ring-2 focus:ring-primary/40"
        >
          {types.map((t) => (
            <option key={t} value={t}>
              {resourceTypeLabel(t)}
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

      {value && (
        <div className="flex items-center justify-between rounded-xl border border-primary/30 bg-primary/5 px-3 py-2">
          <span className="text-sm font-bold text-foreground">
            Selected: {value.label}
            <span className="ml-2 text-xs font-semibold text-muted-foreground">
              {resourceTypeLabel(value.resource_type)} #{value.resource_id}
            </span>
          </span>
          <button
            type="button"
            onClick={() => onChange(null)}
            className="text-xs font-semibold text-muted-foreground hover:text-foreground"
          >
            Change
          </button>
        </div>
      )}

      {!value && (
        <div className="max-h-56 overflow-y-auto rounded-xl border border-border bg-card">
          {loading ? (
            <div className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Searching…
            </div>
          ) : items.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">No resources found.</p>
          ) : (
            items.map((it) => (
              <button
                type="button"
                key={`${it.resource_type}:${it.resource_id}`}
                onClick={() =>
                  onChange({ resource_type: it.resource_type, resource_id: it.resource_id, label: it.label })
                }
                className={cn(
                  "flex w-full items-center justify-between gap-2 border-b border-border px-3 py-2 text-left text-sm last:border-b-0 hover:bg-surface-2",
                )}
              >
                <span className="min-w-0 truncate">
                  <span className="font-bold text-foreground">{it.label}</span>
                  {subjectBadge(it.subjects)}
                </span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {it.published ? "" : "draft · "}#{it.resource_id}
                </span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
