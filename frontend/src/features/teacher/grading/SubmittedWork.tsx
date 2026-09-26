"use client";

/**
 * What the student actually turned in.
 *
 * This is the one thing the four grading surfaces disagreed about: only the homework hub's
 * assignment view ever showed the uploaded pdf or jpg, and it showed it as a thumbnail tile you
 * had to open in another tab. A teacher grading 134 pieces reads the work far more often than
 * they click anything, so here the file is drawn IN the page at the size of the page — the
 * image inline, the pdf in its viewer — with the open-in-a-new-tab link kept for the cases a
 * browser will not render (an old .doc, a file the viewer refuses).
 *
 * The three kinds are decided by `lib/homeworkFileDisplay`, the same helpers the tile uses, so
 * "this is a pdf" cannot come to mean two different things in two places.
 */

import { ExternalLink, FileText, Paperclip } from "lucide-react";
import { fileNameFromUrl, isImageMimeOrName, isPdfMimeOrName } from "@/lib/homeworkFileDisplay";
import type { GradingFile, GradingSubmission } from "./gradingQueueModel";

function label(f: GradingFile): string {
  return (f.file_name || fileNameFromUrl(f.url) || "File").trim() || "File";
}

function OneFile({ file }: { file: GradingFile }) {
  const name = label(file);
  const mime = file.file_type ?? "";
  const image = isImageMimeOrName(mime, name);
  const pdf = !image && isPdfMimeOrName(mime, name);

  return (
    <figure style={{ margin: 0, border: "1px solid var(--dz-border)", borderRadius: 16, overflow: "hidden" }}>
      <figcaption
        style={{
          display: "flex", alignItems: "center", gap: 8, padding: "10px 14px",
          borderBottom: "1px solid var(--dz-border)", background: "var(--dz-neutral-soft)",
        }}
      >
        {pdf ? <FileText size={15} aria-hidden /> : <Paperclip size={15} aria-hidden />}
        <span style={{ minWidth: 0, flex: 1, fontSize: 13, fontWeight: 700, color: "var(--dz-ink)", overflowWrap: "anywhere" }}>
          {name}
        </span>
        <a
          href={file.url}
          target="_blank"
          rel="noreferrer"
          style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 700, color: "var(--dz-indigo)", textDecoration: "none" }}
        >
          Open <ExternalLink size={13} aria-hidden />
        </a>
      </figcaption>

      {image ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={file.url}
          alt={`Work turned in: ${name}`}
          loading="lazy"
          style={{ display: "block", width: "100%", maxHeight: 620, objectFit: "contain", background: "var(--dz-neutral-soft)" }}
        />
      ) : pdf ? (
        <iframe
          src={file.url}
          title={name}
          style={{ display: "block", width: "100%", height: 620, border: 0, background: "var(--dz-neutral-soft)" }}
        />
      ) : (
        <div style={{ padding: "18px 14px", fontSize: 13, color: "var(--dz-mute)" }}>
          This kind of file can&apos;t be shown here. Open it to read the work.
        </div>
      )}
    </figure>
  );
}

/**
 * `locksFileUpload` homework is turned in as a test attempt, so "no files" is the normal state
 * there and must not read as a student who handed in nothing.
 */
export function SubmittedWork({ submission }: { submission: GradingSubmission }) {
  const files = (submission.files ?? []).filter((f) => f && typeof f.url === "string" && f.url);
  const attempt = submission.attempt ?? null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {attempt && (
        <div style={{ padding: "12px 14px", borderRadius: 14, background: "var(--dz-indigo-soft)" }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: "var(--dz-ink)" }}>
            {attempt.practice_test_name || attempt.practice_test_title || "Practice test"}
          </div>
          <div style={{ fontSize: 12, color: "var(--dz-mute)", marginTop: 3 }}>
            Attempt #{attempt.id}
            {attempt.is_completed ? " · finished" : " · still open"}
            {attempt.score != null ? ` · scored ${attempt.score}` : ""}
          </div>
        </div>
      )}

      {files.length === 0 ? (
        <div style={{ fontSize: 13, color: "var(--dz-mute)" }}>
          {attempt
            ? "No files with this one — the work is the test attempt above."
            : "Nothing was uploaded with this submission."}
        </div>
      ) : (
        files.map((f, i) => <OneFile key={f.id ?? `${f.url}-${i}`} file={f} />)
      )}
    </div>
  );
}
