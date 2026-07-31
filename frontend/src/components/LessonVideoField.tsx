"use client";

import { useEffect, useRef, useState } from "react";
import { Link2, Loader2, Upload, Video, X } from "lucide-react";
import VideoPlayer from "@/components/VideoPlayer";
import { uploadVideoToR2, VIDEO_ACCEPT, type VideoUploadTicket } from "@/lib/videoUpload";

const DEFAULT_MAX_BYTES = 2 * 1024 * 1024 * 1024; // 2 GB

function humanSize(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
  return `${Math.round(bytes / 1024 / 1024)} MB`;
}

export interface LessonVideoFieldProps {
  /** Link value (empty when the video is an uploaded file). */
  url: string;
  onUrlChange: (v: string) => void;
  /** Newly-uploaded R2 object key this session (null when none). */
  videoKey: string | null;
  onVideoKeyChange: (key: string | null) => void;
  /** True once the user removes the saved video. */
  removed: boolean;
  onRemovedChange: (v: boolean) => void;
  /** The already-saved video (uploaded file URL preferred, else link) — for preview on edit. */
  existingUrl?: string | null;
  /** Fetches a presigned upload ticket for the given filename. */
  requestUpload: (filename: string) => Promise<VideoUploadTicket>;
  inputClassName?: string;
  idPrefix?: string;
  maxBytes?: number;
}

/**
 * Lesson video: upload a file straight from the computer to R2 (with a progress bar) OR
 * paste a link (YouTube/Vimeo/Loom/Drive). A file and a link never coexist — choosing one
 * clears the other. Shows a live preview and a Remove action.
 */
export default function LessonVideoField({
  url,
  onUrlChange,
  videoKey,
  onVideoKeyChange,
  removed,
  onRemovedChange,
  existingUrl,
  requestUpload,
  inputClassName = "",
  idPrefix = "video",
  maxBytes = DEFAULT_MAX_BYTES,
}: LessonVideoFieldProps) {
  const [file, setFile] = useState<File | null>(null);
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement | null>(null);

  // Local object-URL preview for the selected file; revoked on change/unmount.
  useEffect(() => {
    if (!file) {
      setObjectUrl(null);
      return;
    }
    const u = URL.createObjectURL(file);
    setObjectUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [file]);

  async function pickFile(f: File) {
    setError(null);
    if (f.size > maxBytes) {
      setError(`That video is ${humanSize(f.size)}. The limit is ${humanSize(maxBytes)}.`);
      return;
    }
    setFile(f);
    onUrlChange(""); // a file replaces any link
    onRemovedChange(false);
    setUploading(true);
    setProgress(0);
    try {
      const ticket = await requestUpload(f.name);
      const { promise } = uploadVideoToR2(ticket, f, setProgress);
      await promise;
      onVideoKeyChange(ticket.key);
      setProgress(1);
    } catch (e) {
      const msg =
        (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ||
        (e instanceof Error ? e.message : "Upload failed.");
      setError(msg);
      onVideoKeyChange(null);
      setFile(null);
    } finally {
      setUploading(false);
    }
  }

  function onUrl(v: string) {
    onUrlChange(v);
    if (v.trim()) {
      // Switching to a link discards a pending/complete upload.
      setFile(null);
      onVideoKeyChange(null);
      onRemovedChange(false);
      setError(null);
    }
  }

  function removeVideo() {
    setFile(null);
    onVideoKeyChange(null);
    onUrlChange("");
    onRemovedChange(true);
    setError(null);
    setProgress(null);
  }

  const hasActiveVideo =
    !!objectUrl || !!url.trim() || (!!existingUrl && !removed && !videoKey);

  return (
    <div className="space-y-3">
      {/* Upload button */}
      <div className="flex flex-wrap items-center gap-3">
        <input
          ref={fileInput}
          id={`${idPrefix}-file`}
          type="file"
          accept={VIDEO_ACCEPT}
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void pickFile(f);
            e.target.value = "";
          }}
        />
        <button
          type="button"
          disabled={uploading}
          onClick={() => fileInput.current?.click()}
          className="inline-flex items-center gap-2 rounded-lg border border-border bg-surface px-3.5 py-2 text-sm font-semibold text-foreground transition-colors hover:bg-surface-2 disabled:opacity-60"
        >
          {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
          {uploading ? "Uploading…" : "Upload from computer"}
        </button>
        <span className="text-xs text-muted-foreground">up to {humanSize(maxBytes)}</span>
      </div>

      {/* Upload progress */}
      {uploading && progress !== null && (
        <div className="space-y-1">
          <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary transition-[width] duration-150"
              style={{ width: `${Math.round(progress * 100)}%` }}
            />
          </div>
          <p className="text-xs text-muted-foreground">{Math.round(progress * 100)}% uploaded</p>
        </div>
      )}

      {/* Link alternative */}
      <div className="relative">
        <Link2 className="pointer-events-none absolute left-3.5 top-1/2 h-[15px] w-[15px] -translate-y-1/2 text-muted-foreground" />
        <input
          id={`${idPrefix}-url`}
          type="url"
          value={url}
          onChange={(e) => onUrl(e.target.value)}
          placeholder="…or paste a YouTube, Vimeo, Loom, or Google Drive link"
          className={`${inputClassName} pl-10`}
          disabled={uploading}
        />
      </div>

      {error && <p className="text-sm text-error">{error}</p>}

      {/* Preview */}
      {objectUrl ? (
        <div className="max-w-md space-y-2">
          <div className="relative w-full overflow-hidden rounded-xl bg-black" style={{ aspectRatio: "16 / 9" }}>
            <video src={objectUrl} controls playsInline className="absolute inset-0 h-full w-full" />
          </div>
        </div>
      ) : url.trim() ? (
        <div className="max-w-md">
          <VideoPlayer url={url} />
        </div>
      ) : existingUrl && !removed && !videoKey ? (
        <div className="max-w-md space-y-2">
          <p className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
            <Video className="h-3.5 w-3.5" /> Current video
          </p>
          <VideoPlayer url={existingUrl} />
        </div>
      ) : null}

      {hasActiveVideo && !uploading && (
        <button
          type="button"
          onClick={removeVideo}
          className="inline-flex items-center gap-1.5 text-[13px] font-medium text-muted-foreground transition-colors hover:text-error"
        >
          <X className="h-3.5 w-3.5" /> Remove video
        </button>
      )}
    </div>
  );
}
