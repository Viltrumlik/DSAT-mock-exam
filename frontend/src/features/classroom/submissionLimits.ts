/**
 * The limits a homework submission is held to, and the one place the upload panel reads them.
 *
 * The server owns all of them: `backend/classes/submission_limits.py` and the
 * `CLASSROOM_SUBMISSION_*` settings re-check every one on POST, and a batch that gets past this
 * file is still refused there. So the assignment payload carries them (`submission_limits`) and
 * this module only reshapes what it is told — ops can lower a limit with an environment variable
 * and the panel moves with it. They are checked here as well as there so a student with a 60 MB
 * scan learns it while picking rather than after waiting out an upload that was never going to
 * land, and they live in this module alone so the panel and its tests cannot drift apart.
 */

/** What the server may not accept, as it words it in the assignment payload. */
export interface SubmissionLimitsPayload {
  max_files_per_submission?: number | null;
  max_file_bytes?: number | null;
  max_batch_bytes?: number | null;
  allowed_extensions?: string[] | null;
}

export interface SubmissionLimits {
  /** Files one submission may hold in total — what is already attached plus what is arriving. */
  maxFiles: number;
  /** Largest single file. */
  maxFileBytes: number;
  /** Largest total for the *new* files in one request; what is already attached does not count. */
  maxBatchBytes: number;
  /** Lower-case, leading dot — ".pdf", ".jpg". A file whose name has no dot is not judged here. */
  allowedExtensions: readonly string[];
}

/**
 * Used only until the assignment payload answers — an older backend, or the first paint of a
 * cached page. Each is the default the deployed settings ship with, except the batch figure:
 * Nginx caps an `/api/` body at 60 MB, below Django's 100 MB, and a guess that is too generous
 * is the one that costs a student their upload.
 */
export const FALLBACK_SUBMISSION_LIMITS: SubmissionLimits = {
  maxFiles: 50,
  maxFileBytes: 50 * 1024 * 1024,
  maxBatchBytes: 60 * 1024 * 1024,
  allowedExtensions: [
    ".doc", ".docx", ".gif", ".jpeg", ".jpg", ".pdf", ".png",
    ".ppt", ".pptx", ".txt", ".webp", ".xls", ".xlsx",
  ],
};

function positive(n: unknown, fallback: number): number {
  return typeof n === "number" && Number.isFinite(n) && n > 0 ? n : fallback;
}

/** ".PDF" and "pdf" both mean the same thing to the server, which lower-cases and expects a dot. */
function normalizeExtension(raw: string): string {
  const t = raw.trim().toLowerCase();
  if (!t) return "";
  return t.startsWith(".") ? t : `.${t}`;
}

/** The served limits, or the fallbacks above for whichever the payload does not carry. */
export function resolveSubmissionLimits(served?: SubmissionLimitsPayload | null): SubmissionLimits {
  const extensions = (served?.allowed_extensions ?? [])
    .filter((x): x is string => typeof x === "string")
    .map(normalizeExtension)
    .filter(Boolean);
  return {
    maxFiles: positive(served?.max_files_per_submission, FALLBACK_SUBMISSION_LIMITS.maxFiles),
    maxFileBytes: positive(served?.max_file_bytes, FALLBACK_SUBMISSION_LIMITS.maxFileBytes),
    maxBatchBytes: positive(served?.max_batch_bytes, FALLBACK_SUBMISSION_LIMITS.maxBatchBytes),
    // An empty list would mean "nothing can be turned in", which no deployment intends and which
    // would refuse every file a student picked.
    allowedExtensions: extensions.length > 0 ? extensions : FALLBACK_SUBMISSION_LIMITS.allowedExtensions,
  };
}

/**
 * What makes two picks the same file.
 *
 * A `File` carries no id, and two `File` objects for one file on disk are never `===` — the
 * picker mints a fresh object each time it is opened. Name, size and last-modified time is all a
 * browser can see of a file, and it is enough to tell "picked page1.jpg twice" apart from "picked
 * two different scans that happen to share a folder". Two genuinely distinct files that agree on
 * all three read as one here; that costs a student one re-pick, where the alternative costs them
 * a silent duplicate in front of their teacher.
 */
export function fileIdentity(f: File): string {
  return `${f.name}:${f.size}:${f.lastModified}`;
}

/** Bytes as a student reads them: "12.4 MB", "680 KB", "0 B". */
export function sizeLabel(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${Math.round(kb)} KB`;
  const mb = kb / 1024;
  return `${mb >= 10 ? Math.round(mb) : mb.toFixed(1)} MB`;
}

/** ".heic" from "IMG_0421.heic", "" from a name with no dot. Mirrors the server's splitext. */
export function fileExtension(name: string): string {
  const base = name.slice(name.lastIndexOf("/") + 1);
  const dot = base.lastIndexOf(".");
  return dot > -1 ? base.slice(dot).toLowerCase() : "";
}

/** For the picker's `accept`: ".pdf,.png,.jpg". A hint to the file dialog, never a check. */
export function acceptAttribute(limits: SubmissionLimits): string {
  return limits.allowedExtensions.join(",");
}

/** The same list as a student reads it: "PDF, PNG, JPG". */
export function fileTypeList(limits: SubmissionLimits): string {
  return limits.allowedExtensions.map((e) => e.replace(/^\./, "").toUpperCase()).join(", ");
}

export interface BatchCheck {
  /** Queued files of a kind the server will not take, in the order they were picked. */
  disallowed: File[];
  /** Queued files over the per-file limit, in the order they were picked. */
  tooBig: File[];
  /** Total bytes of the queued files — what this request would carry. */
  totalBytes: number;
  /** Files the submission would hold once these are added, attached ones included. */
  totalFiles: number;
  /** One sentence for the student, or null when the batch is ready to go. */
  problem: string | null;
}

/** "One more file is over too." / " 3 more files are over too." — never a bare count of 1. */
function andTheOthers(count: number, one: string, many: (n: number) => string): string {
  if (count === 2) return ` ${one}`;
  if (count > 2) return ` ${many(count - 1)}`;
  return "";
}

/**
 * Check a queue against every limit before anything is sent.
 *
 * The order follows the server's own: it validates each file's type first, then its size, and
 * refuses the whole request on the first bad one — so a student who would lose ten files to a
 * single `.heic` hears about the `.heic`. A problem that names a file is worth more than "the
 * total is too big", which is the same fact stated without a culprit.
 */
export function checkSubmissionBatch(
  queued: File[],
  attachedCount: number,
  limits: SubmissionLimits,
): BatchCheck {
  const allowed = new Set(limits.allowedExtensions);
  // A file with no extension at all passes here because it passes on the server: its check
  // reads `if ext_lower and ext_lower not in allowed`.
  const disallowed = queued.filter((f) => {
    const ext = fileExtension(f.name);
    return ext !== "" && !allowed.has(ext);
  });
  const tooBig = queued.filter((f) => f.size > limits.maxFileBytes);
  const totalBytes = queued.reduce((sum, f) => sum + f.size, 0);
  const totalFiles = attachedCount + queued.length;

  let problem: string | null = null;
  if (disallowed.length > 0) {
    const first = disallowed[0];
    problem =
      `“${first.name}” isn’t a kind of file this takes. These are: ${fileTypeList(limits)}. ` +
      `Save it as one of them and choose it again.` +
      andTheOthers(
        disallowed.length,
        "One more file needs the same.",
        (n) => `${n} more files need the same.`,
      );
  } else if (tooBig.length > 0) {
    const first = tooBig[0];
    problem =
      `“${first.name}” is ${sizeLabel(first.size)}. Each file can be up to ` +
      `${sizeLabel(limits.maxFileBytes)} — save it a little smaller, or split it into a few files.` +
      andTheOthers(
        tooBig.length,
        "One more file is over too.",
        (n) => `${n} more files are over too.`,
      );
  } else if (totalFiles > limits.maxFiles) {
    problem =
      `That would make ${totalFiles} files on this submission. Up to ` +
      `${limits.maxFiles} fit — take a few out and send the rest.`;
  } else if (totalBytes > limits.maxBatchBytes) {
    problem =
      `These come to ${sizeLabel(totalBytes)} together. One upload carries ` +
      `${sizeLabel(limits.maxBatchBytes)} — send some now, then add the rest the same way.`;
  }

  return { disallowed, tooBig, totalBytes, totalFiles, problem };
}
