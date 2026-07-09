"use client";

import { useEffect, useMemo, useState } from "react";
import { FileText, Loader2, Search } from "lucide-react";
import { accessApi, resourceTypeLabel, HIDDEN_PICKER_TYPES, type ResourcePickerItem } from "@/lib/accessApi";
import { cn } from "@/lib/cn";
import { accClass, Chip, Pill } from "./accessUi";
import { CheckBox } from "./StudentMultiSelect";

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
  single = false,
}: {
  value: SelectedResource[];
  onChange: (r: SelectedResource[]) => void;
  /** When true, only one resource may be selected (clicking replaces the selection). */
  single?: boolean;
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
    const picked = { resource_type: it.resource_type, resource_id: it.resource_id, label: it.label };
    if (selectedKeys.has(key)) {
      onChange(value.filter((v) => `${v.resource_type}:${v.resource_id}` !== key));
    } else {
      onChange(single ? [picked] : [...value, picked]);
    }
  };

  // Group standalone sections by their collection (former pastpaper pack); other types stay flat.
  const grouped = useMemo(() => {
    if (type !== "practice_test") return null;
    const groups = new Map<string, ResourcePickerItem[]>();
    for (const it of visible) {
      const g = (it.group || "").trim() || "Ungrouped";
      const arr = groups.get(g) ?? [];
      arr.push(it);
      groups.set(g, arr);
    }
    return Array.from(groups.entries());
  }, [type, visible]);

  const iconTint = (subs: string[]) => {
    const s = (subs ?? []).map((x) => x.toLowerCase());
    if (s.includes("math")) return "bg-blue-100 text-blue-700";
    if (s.includes("english") || s.includes("reading")) return "bg-emerald-100 text-emerald-700";
    return "bg-primary/10 text-primary";
  };

  const renderRow = (it: ResourcePickerItem) => {
    const checked = selectedKeys.has(`${it.resource_type}:${it.resource_id}`);
    const subtitle = [
      (it.subjects ?? []).join(" · "),
      it.published ? "" : "draft",
    ].filter(Boolean).join(" · ");
    return (
      <button
        type="button"
        key={`${it.resource_type}:${it.resource_id}`}
        onClick={() => toggle(it)}
        className={cn(
          "flex w-full items-center gap-3 px-3.5 py-3 text-left",
          checked ? accClass.selectableOn : accClass.selectable,
        )}
      >
        <span className={cn("grid h-9 w-9 shrink-0 place-items-center rounded-lg", iconTint(it.subjects))}>
          <FileText className="h-4 w-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-bold text-foreground">{it.label}</span>
          {subtitle && <span className="block truncate text-xs text-muted-foreground">{subtitle}</span>}
        </span>
        <span className="shrink-0 rounded-md bg-surface-2 px-1.5 py-0.5 text-[11px] font-bold text-muted-foreground">
          #{it.resource_id}
        </span>
        <CheckBox checked={checked} />
      </button>
    );
  };

  return (
    <div className="space-y-3">
      {/* Resource-type tabs */}
      {!single && types.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className={accClass.eyebrow}>Tests / resources</span>
          <div className="flex flex-wrap gap-2">
            {types.map((t) => (
              <Pill key={t} active={type === t} onClick={() => setType(t)}>
                {resourceTypeLabel(t)}
              </Pill>
            ))}
          </div>
        </div>
      )}

      {/* Subject filter pills + search */}
      <div className="flex flex-wrap items-center gap-2">
        <span className={accClass.eyebrow}>Subject</span>
        {SUBJECT_FILTERS.map((s) => (
          <Pill key={s.key} active={subject === s.key} onClick={() => setSubject(s.key)}>
            {s.label}
          </Pill>
        ))}
      </div>
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by title or id…"
          className={accClass.search}
        />
      </div>

      {/* Selected tests (chips) */}
      {value.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          {value.map((v) => (
            <Chip
              key={`${v.resource_type}:${v.resource_id}`}
              label={v.label}
              onRemove={() =>
                onChange(value.filter((x) => !(x.resource_type === v.resource_type && x.resource_id === v.resource_id)))
              }
            />
          ))}
          <button
            type="button"
            onClick={() => onChange([])}
            className="text-xs font-semibold text-muted-foreground transition-colors hover:text-foreground"
          >
            Clear all
          </button>
        </div>
      )}

      {/* Result list */}
      <div className="max-h-[360px] space-y-2 overflow-y-auto pr-1">
        {loading ? (
          <div className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Searching…
          </div>
        ) : visible.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            No resources found.
          </p>
        ) : grouped ? (
          grouped.map(([group, rows]) => (
            <div key={group} className="space-y-2">
              <div className="px-1 pt-1 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                {group}
              </div>
              {rows.map(renderRow)}
            </div>
          ))
        ) : (
          visible.map(renderRow)
        )}
      </div>
    </div>
  );
}
