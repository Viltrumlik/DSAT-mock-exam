"use client";

import { useEffect, useMemo } from "react";
import { ImagePlus, X } from "lucide-react";
import { STUDIO_FIELD_LABEL } from "@/components/studio/primitives";

const LABEL = STUDIO_FIELD_LABEL;

// ─── Inline image upload widget ───────────────────────────────────────────────

export function ImageUpload({
  label,
  existingUrl,
  file,
  cleared,
  onSet,
  onClear,
  onCancel,
  disabled,
}: {
  label: string;
  existingUrl?: string | null;
  file?: File;
  cleared?: boolean;
  onSet: (f: File) => void;
  onClear: () => void;
  onCancel: () => void;
  disabled?: boolean;
}) {
  const showExisting = existingUrl && !cleared && !file;
  const showPreview = !!file;

  // Memoize + revoke the object URL so the local preview doesn't leak a blob URL
  // on every render (createObjectURL allocates each call).
  const previewUrl = useMemo(() => (file ? URL.createObjectURL(file) : null), [file]);
  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  return (
    <div className="space-y-1.5">
      <p className={LABEL}>{label}</p>
      <div className="flex flex-wrap items-center gap-2">
        {showExisting && (
          <>
            <img src={existingUrl} alt={label} className="max-h-24 rounded-xl border border-border object-contain" />
            <button
              type="button"
              disabled={disabled}
              onClick={onClear}
              className="inline-flex items-center gap-1 rounded-lg border border-red-200 bg-red-50 px-2 py-1 text-xs font-semibold text-red-700 hover:bg-red-100 transition-colors"
            >
              <X className="h-3 w-3" /> Remove
            </button>
          </>
        )}
        {showPreview && (
          <>
            {previewUrl && <img src={previewUrl} alt="Preview" className="max-h-24 rounded-xl border border-border object-contain" />}
            <button
              type="button"
              disabled={disabled}
              onClick={onCancel}
              className="inline-flex items-center gap-1 rounded-lg border border-border bg-card px-2 py-1 text-xs font-semibold text-muted-foreground hover:bg-surface-2 transition-colors"
            >
              <X className="h-3 w-3" /> Cancel
            </button>
          </>
        )}
        <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-xl border border-dashed border-border bg-surface-2/30 px-3 py-2 text-xs font-semibold text-muted-foreground hover:bg-surface-2/60 transition-colors">
          <ImagePlus className="h-3.5 w-3.5" />
          {file ? "Change" : existingUrl && !cleared ? "Replace" : "Upload image"}
          <input
            type="file"
            accept="image/*"
            className="sr-only"
            disabled={disabled}
            onChange={(e) => { const f = e.target.files?.[0]; if (f) onSet(f); }}
          />
        </label>
      </div>
    </div>
  );
}
