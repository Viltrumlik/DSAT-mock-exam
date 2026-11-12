"use client";

import { useEffect, useMemo } from "react";

import { Icon } from "@/components/ui/Icon";
import { buttonClass } from "@/features/console/ui";
import { FIELD_LABEL } from "@/features/questionsAdmin/questionLook";
import { cn } from "@/lib/cn";

/**
 * An image on a question or a choice (design handoff v0.3, PR 17c), as the module editor draws it: the picture,
 * Remove (a saved one) or Cancel (a picked one), and Upload / Replace / Change. Nothing is sent until the
 * question is saved — the parent keeps the file.
 */
export function ImageUpload({
  label,
  existingUrl,
  file,
  cleared,
  onSet,
  onClear,
  onCancel,
  disabled,
  size = "lg",
  showLabel = true,
  words = { add: "Upload image", change: "Change", replace: "Replace" },
}: {
  label: string;
  existingUrl?: string | null;
  file?: File;
  cleared?: boolean;
  onSet: (f: File) => void;
  onClear: () => void;
  onCancel: () => void;
  disabled?: boolean;
  /** "lg" for the question's image, "sm" under a choice. */
  size?: "lg" | "sm";
  /** The label above it; a choice's image goes without one (its name is the alt text). */
  showLabel?: boolean;
  words?: { add: string; change: string; replace: string };
}) {
  const showExisting = existingUrl && !cleared && !file;

  // Memoize + revoke the object URL so the local preview doesn't leak a blob URL
  // on every render (createObjectURL allocates each call).
  const previewUrl = useMemo(() => (file ? URL.createObjectURL(file) : null), [file]);
  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  const thumb = cn(size === "lg" ? "max-h-32 rounded-[12px]" : "max-h-16 rounded-[10px]", "border border-ms-border bg-ms-card object-contain");

  return (
    <div className="flex flex-col">
      {showLabel ? <p className={FIELD_LABEL}>{label}</p> : null}
      <div className="flex flex-wrap items-center gap-2">
        {showExisting && (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={existingUrl} alt={label} className={thumb} />
            <button
              type="button"
              disabled={disabled}
              onClick={onClear}
              className={buttonClass({ variant: "ghost", size: "sm", className: "text-ms-critical-fg hover:text-ms-critical-fg" })}
            >
              <Icon name="x" size="sm" /> Remove
            </button>
          </>
        )}
        {file && (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {previewUrl && <img src={previewUrl} alt="Preview" className={thumb} />}
            <button type="button" disabled={disabled} onClick={onCancel} className={buttonClass({ variant: "ghost", size: "sm" })}>
              <Icon name="x" size="sm" /> Cancel
            </button>
          </>
        )}
        <label
          className={buttonClass({
            variant: size === "lg" ? "secondary" : "ghost",
            size: "sm",
            className: cn("cursor-pointer", disabled && "pointer-events-none opacity-50"),
          })}
        >
          <Icon name="image" size="sm" />
          {file ? words.change : existingUrl && !cleared ? words.replace : words.add}
          <input
            type="file"
            accept="image/*"
            className="sr-only"
            disabled={disabled}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onSet(f);
            }}
          />
        </label>
      </div>
    </div>
  );
}
