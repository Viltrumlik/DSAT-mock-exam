"use client";

import { useEffect, useMemo, useState } from "react";

import { Icon } from "@/components/ui/Icon";
import { accessApi, resourceTypeLabel, HIDDEN_PICKER_TYPES, type ResourcePickerItem } from "@/lib/accessApi";
import { cn } from "@/lib/cn";
import { EMPTY_BOX, EYEBROW, FilterPill, PickMark, RemovableChip, ROW, ROW_OFF, ROW_ON, SearchInput, TEXT_ACTION } from "./accessConsole";

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

  // The test's subject in the console's subject colours: Math violet, R&W rose.
  const iconTint = (subs: string[]) => {
    const s = (subs ?? []).map((x) => x.toLowerCase());
    if (s.includes("math")) return "bg-ms-math-soft text-ms-math-fg";
    if (s.includes("english") || s.includes("reading")) return "bg-ms-rw-soft text-ms-rw-fg";
    return "bg-ms-primary-soft text-ms-primary-text";
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
        aria-pressed={checked}
        onClick={() => toggle(it)}
        className={cn(ROW, checked ? ROW_ON : ROW_OFF)}
      >
        <span className={cn("grid size-9 shrink-0 place-items-center rounded-[8px]", iconTint(it.subjects))}>
          <Icon name="file" size="sm" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[14px] font-semibold text-ms-fg">{it.label}</span>
          {subtitle && <span className="block truncate text-[13px] text-ms-fg-3">{subtitle}</span>}
        </span>
        <span className="shrink-0 rounded-[6px] bg-ms-surface-2 px-1.5 py-0.5 font-ms-mono text-[12px] text-ms-fg-2">
          #{it.resource_id}
        </span>
        <PickMark checked={checked} />
      </button>
    );
  };

  return (
    <div className="flex flex-col gap-3">
      {/* Resource-type tabs */}
      {!single && types.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className={EYEBROW}>Tests / resources</span>
          <div className="flex flex-wrap gap-2">
            {types.map((t) => (
              <FilterPill key={t} active={type === t} onClick={() => setType(t)}>
                {resourceTypeLabel(t)}
              </FilterPill>
            ))}
          </div>
        </div>
      )}

      {/* Subject filter pills + search */}
      <div className="flex flex-wrap items-center gap-2">
        <span className={EYEBROW}>Subject</span>
        {SUBJECT_FILTERS.map((s) => (
          <FilterPill key={s.key} active={subject === s.key} onClick={() => setSubject(s.key)}>
            {s.label}
          </FilterPill>
        ))}
      </div>
      <SearchInput value={search} onChange={setSearch} placeholder="Search by title or id…" />

      {/* Selected tests (chips) */}
      {value.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          {value.map((v) => (
            <RemovableChip
              key={`${v.resource_type}:${v.resource_id}`}
              label={v.label}
              onRemove={() =>
                onChange(value.filter((x) => !(x.resource_type === v.resource_type && x.resource_id === v.resource_id)))
              }
            />
          ))}
          <button type="button" onClick={() => onChange([])} className={TEXT_ACTION}>
            Clear all
          </button>
        </div>
      )}

      {/* Result list */}
      <div className="flex max-h-[360px] flex-col gap-2 overflow-y-auto pr-1">
        {loading ? (
          <div role="status" className="flex items-center gap-2 p-4 text-[14px] text-ms-fg-3">
            <Icon name="loader" size="sm" className="animate-ms-spin" /> Searching…
          </div>
        ) : visible.length === 0 ? (
          <p className={EMPTY_BOX}>No resources found.</p>
        ) : grouped ? (
          grouped.map(([group, rows]) => (
            <div key={group} className="flex flex-col gap-2">
              <div className="text-ms-over px-1 pt-1 text-ms-fg-3">{group}</div>
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
