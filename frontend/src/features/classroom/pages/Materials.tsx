"use client";

import { useState } from "react";
import { Download, Trash2, FileText } from "lucide-react";
import { normalizeApiError } from "@/lib/apiError";
import { Card, CardHeader, Button, TextField, LoadingState } from "../ui";
import { capabilitiesFor } from "../capabilities";
import { useMaterials, useUploadMaterial, useDeleteMaterial } from "../hooks";
import type { ClassroomWithRole } from "../types";

/** Downloadable study materials (PDF/DOCX). Staff upload/remove; everyone downloads. */
export function Materials({ classroom }: { classroom: ClassroomWithRole }) {
  const id = Number(classroom.id);
  const caps = capabilitiesFor(classroom.my_role);
  const { data, isLoading } = useMaterials(id);
  const upload = useUploadMaterial(id);
  const del = useDeleteMaterial(id);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const materials = data?.results ?? [];

  async function submit() {
    setErr(null);
    if (!title.trim()) return setErr("Title is required.");
    if (!file) return setErr("Choose a PDF or Word document.");
    const fd = new FormData();
    fd.append("title", title.trim());
    fd.append("description", description.trim());
    fd.append("file", file);
    try {
      await upload.mutateAsync(fd);
      setTitle("");
      setDescription("");
      setFile(null);
    } catch (e) {
      setErr(normalizeApiError(e).message);
    }
  }

  return (
    <div className="space-y-5">
      {caps.canManageAssignments && (
        <Card>
          <CardHeader title="Upload material" description="Share a PDF or Word document with this class. Students can download it." />
          <div className="mt-5 max-w-lg space-y-4">
            {err && <p className="rounded-lg bg-rose-500/10 px-3 py-2 text-sm text-rose-600">{err}</p>}
            <TextField label="Title" required value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Unit 3 vocabulary list" />
            <TextField label="Description" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Optional" />
            <div>
              <label className="mb-1.5 block text-sm font-medium text-foreground">File (PDF, DOC, DOCX)</label>
              <input
                type="file"
                accept=".pdf,.doc,.docx"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                className="block w-full text-sm text-muted-foreground file:mr-3 file:rounded-lg file:border-0 file:bg-surface-2 file:px-3 file:py-2 file:text-sm file:font-semibold file:text-foreground"
              />
            </div>
            <Button loading={upload.isPending} onClick={submit}>Upload</Button>
          </div>
        </Card>
      )}

      <Card>
        <CardHeader title="Materials" description="Downloadable resources for this class." />
        {isLoading ? (
          <LoadingState label="Loading materials…" />
        ) : materials.length === 0 ? (
          <p className="mt-4 text-sm text-muted-foreground">No materials yet.</p>
        ) : (
          <ul className="mt-4 divide-y divide-border">
            {materials.map((m) => (
              <li key={m.id} className="flex items-center gap-3 py-3">
                <FileText className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-foreground">{m.title}</p>
                  {m.description && <p className="truncate text-xs text-muted-foreground">{m.description}</p>}
                </div>
                {m.file_url && (
                  <a
                    href={m.file_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-semibold text-primary hover:bg-surface-2"
                  >
                    <Download className="h-4 w-4" /> Download
                  </a>
                )}
                {caps.canManageAssignments && (
                  <button
                    onClick={() => del.mutate(m.id)}
                    disabled={del.isPending}
                    className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm font-semibold text-rose-600 hover:bg-rose-500/10 disabled:opacity-50"
                    aria-label={`Remove ${m.title}`}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
