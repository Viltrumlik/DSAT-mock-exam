"use client";

import { useMemo, useState } from "react";
import { Download, Trash2, Upload, FolderOpen } from "lucide-react";
import { cn } from "@/lib/cn";
import { normalizeApiError } from "@/lib/apiError";
import { pushGlobalToast } from "@/lib/toastBus";
import { Card, Button, TextField, Dialog, LoadingState, EmptyState, ConfirmDialog } from "../ui";
import { capabilitiesFor } from "../capabilities";
import { useMaterials, useUploadMaterial, useDeleteMaterial, type ClassroomMaterial } from "../hooks";
import type { ClassroomWithRole } from "../types";
import { materialMeta, orderedCategories, formatBytes, formatShortDate, type MaterialCategory } from "./materialMeta";

const ACCEPT =
  ".pdf,.doc,.docx,.rtf,.txt,.ppt,.pptx,.key,.odp,.xls,.xlsx,.csv,.mp3,.m4a,.wav,.aac,.ogg,.png,.jpg,.jpeg";

type Filter = "All" | MaterialCategory;

/** Downloadable study materials. Staff upload/remove; everyone downloads. */
export function Materials({ classroom }: { classroom: ClassroomWithRole }) {
  const id = Number(classroom.id);
  const caps = capabilitiesFor(classroom.my_role);
  const { data, isLoading } = useMaterials(id);
  const upload = useUploadMaterial(id);
  const del = useDeleteMaterial(id);

  const [uploadOpen, setUploadOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<{ id: number; title: string } | null>(null);
  const [filter, setFilter] = useState<Filter>("All");

  const materials = useMemo(() => data?.results ?? [], [data]);

  // Per-category counts for the filter pills.
  const counts = useMemo(() => {
    const c: Record<MaterialCategory, number> = { Document: 0, Slides: 0, Audio: 0 };
    for (const m of materials) c[materialMeta(m.file_name ?? m.file_url).category] += 1;
    return c;
  }, [materials]);
  const categories = orderedCategories(
    new Set((Object.keys(counts) as MaterialCategory[]).filter((c) => counts[c] > 0)),
  );

  const visible = materials.filter(
    (m) => filter === "All" || materialMeta(m.file_name ?? m.file_url).category === filter,
  );

  function resetForm() {
    setTitle("");
    setDescription("");
    setFile(null);
    setErr(null);
  }

  async function submit() {
    setErr(null);
    if (!title.trim()) return setErr("Title is required.");
    if (!file) return setErr("Choose a file to upload.");
    const fd = new FormData();
    fd.append("title", title.trim());
    fd.append("description", description.trim());
    fd.append("file", file);
    try {
      await upload.mutateAsync(fd);
      resetForm();
      setUploadOpen(false);
      pushGlobalToast({ tone: "success", message: "Material uploaded." });
    } catch (e) {
      setErr(normalizeApiError(e).message);
    }
  }

  async function confirmDelete() {
    if (!pendingDelete) return;
    try {
      await del.mutateAsync(pendingDelete.id);
      pushGlobalToast({ tone: "success", message: `Removed “${pendingDelete.title}”.` });
      setPendingDelete(null);
    } catch (e) {
      pushGlobalToast({ tone: "error", message: normalizeApiError(e).message });
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight text-foreground sm:text-[28px]">Materials</h1>
          <p className="mt-1 text-sm text-muted-foreground">Downloadable resources for this class</p>
        </div>
        {caps.canManageAssignments && (
          <Button icon={Upload} onClick={() => { resetForm(); setUploadOpen(true); }}>
            Upload
          </Button>
        )}
      </div>

      {/* Category filter pills */}
      {materials.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <FilterPill label="All" count={materials.length} active={filter === "All"} onClick={() => setFilter("All")} />
          {categories.map((cat) => (
            <FilterPill key={cat} label={cat} count={counts[cat]} active={filter === cat} onClick={() => setFilter(cat)} />
          ))}
        </div>
      )}

      {/* Grid */}
      {isLoading ? (
        <LoadingState label="Loading materials…" />
      ) : materials.length === 0 ? (
        <EmptyState
          icon={FolderOpen}
          title="No materials yet"
          description={caps.canManageAssignments ? "Upload a file to share it with this class." : "Your teacher hasn't shared any materials yet."}
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {visible.map((m) => (
            <MaterialCard
              key={m.id}
              material={m}
              canManage={caps.canManageAssignments}
              onDelete={() => setPendingDelete({ id: m.id, title: m.title })}
              deleting={del.isPending}
            />
          ))}
        </div>
      )}

      {/* Upload dialog */}
      <Dialog
        open={uploadOpen}
        onClose={() => setUploadOpen(false)}
        title="Upload material"
        description="Share a file with this class. Students can download it."
        footer={
          <>
            <Button variant="ghost" onClick={() => setUploadOpen(false)}>Cancel</Button>
            <Button icon={Upload} loading={upload.isPending} onClick={submit}>Upload</Button>
          </>
        }
      >
        <div className="space-y-4">
          {err && <p className="rounded-lg bg-rose-500/10 px-3 py-2 text-sm text-rose-600">{err}</p>}
          <TextField label="Title" required value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Unit 3 vocabulary list" />
          <TextField label="Description" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Optional" />
          <div>
            <label className="mb-1.5 block text-xs font-semibold text-[var(--text-label)]">File</label>
            <input
              type="file"
              accept={ACCEPT}
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="block w-full text-sm text-muted-foreground file:mr-3 file:rounded-lg file:border-0 file:bg-surface-2 file:px-3 file:py-2 file:text-sm file:font-semibold file:text-foreground"
            />
            <p className="mt-1.5 text-xs text-muted-foreground">Documents, slides, sheets, or audio.</p>
          </div>
        </div>
      </Dialog>

      <ConfirmDialog
        open={pendingDelete !== null}
        title="Remove material?"
        description={pendingDelete ? `“${pendingDelete.title}” will be removed for everyone in this class. This can't be undone.` : ""}
        confirmLabel="Remove"
        tone="danger"
        loading={del.isPending}
        onConfirm={confirmDelete}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  );
}

function FilterPill({ label, count, active, onClick }: { label: string; count: number; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-2 rounded-full border px-4 py-1.5 text-sm font-bold transition-colors",
        active
          ? "border-primary/30 bg-primary/10 text-primary"
          : "border-border bg-card text-muted-foreground hover:bg-surface-2",
      )}
    >
      {label}
      <span
        className={cn(
          "min-w-[1.25rem] rounded-full px-1.5 py-0.5 text-center text-[11px] font-bold",
          active ? "bg-primary/15 text-primary" : "bg-surface-2 text-muted-foreground",
        )}
      >
        {count}
      </span>
    </button>
  );
}

function MaterialCard({
  material: m,
  canManage,
  onDelete,
  deleting,
}: {
  material: ClassroomMaterial;
  canManage: boolean;
  onDelete: () => void;
  deleting: boolean;
}) {
  const meta = materialMeta(m.file_name ?? m.file_url);
  const size = formatBytes(m.file_size);
  const date = formatShortDate(m.created_at);
  const metaLine = [size, date].filter(Boolean).join(" · ");

  return (
    <Card pad="none" className="flex flex-col p-5">
      <div className="flex items-start justify-between">
        <div className={cn("flex h-11 w-11 items-center justify-center rounded-xl", meta.iconWrap)}>
          <meta.Icon className="h-5 w-5" aria-hidden />
        </div>
        <div className="flex items-center gap-1.5">
          {canManage && (
            <button
              type="button"
              onClick={onDelete}
              disabled={deleting}
              aria-label={`Remove ${m.title}`}
              className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-rose-500/10 hover:text-rose-600 disabled:opacity-50"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          )}
          <span className={cn("rounded-md px-2 py-0.5 text-[10px] font-extrabold tracking-wide", meta.badge)}>
            {meta.label}
          </span>
        </div>
      </div>

      <h3 className="mt-3 line-clamp-1 text-[15px] font-bold text-foreground">{m.title}</h3>
      {m.description && <p className="mt-0.5 line-clamp-2 text-sm text-muted-foreground">{m.description}</p>}

      <div className="mt-auto pt-3">
        {metaLine && <p className="text-xs text-muted-foreground">{metaLine}</p>}
        {m.file_url && (
          <a
            href={m.file_url}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-3 inline-flex h-10 w-full items-center justify-center gap-2 rounded-xl bg-primary text-sm font-semibold text-white shadow-sm transition-colors hover:bg-[var(--primary-hover)]"
          >
            <Download className="h-4 w-4" /> Download
          </a>
        )}
      </div>
    </Card>
  );
}
