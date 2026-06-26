import {
  FileText,
  Presentation,
  Music,
  Table,
  Image as ImageIcon,
  File,
  type LucideIcon,
} from "lucide-react";

export type MaterialCategory = "Document" | "Slides" | "Audio";

export interface MaterialMeta {
  /** Short uppercase badge label, e.g. "PDF". */
  label: string;
  /** Coarse filter category. */
  category: MaterialCategory;
  Icon: LucideIcon;
  /** Tailwind classes for the icon tile background + icon color. */
  iconWrap: string;
  /** Tailwind classes for the file-type badge. */
  badge: string;
}

const SLIDE_EXTS = new Set(["ppt", "pptx", "key", "odp"]);
const AUDIO_EXTS = new Set(["mp3", "m4a", "wav", "aac", "ogg"]);

// Per-extension visual treatment (colors mirror the design mockup).
const ROSE = { iconWrap: "bg-rose-50 text-rose-500 dark:bg-rose-500/10", badge: "bg-rose-50 text-rose-500 dark:bg-rose-500/10 dark:text-rose-300" };
const BLUE = { iconWrap: "bg-blue-50 text-blue-600 dark:bg-blue-500/10", badge: "bg-blue-50 text-blue-600 dark:bg-blue-500/10 dark:text-blue-300" };
const AMBER = { iconWrap: "bg-amber-50 text-amber-500 dark:bg-amber-500/10", badge: "bg-amber-50 text-amber-600 dark:bg-amber-500/10 dark:text-amber-300" };
const VIOLET = { iconWrap: "bg-violet-50 text-violet-500 dark:bg-violet-500/10", badge: "bg-violet-50 text-violet-500 dark:bg-violet-500/10 dark:text-violet-300" };
const EMERALD = { iconWrap: "bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10", badge: "bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-300" };
const SLATE = { iconWrap: "bg-slate-100 text-slate-500 dark:bg-slate-500/10", badge: "bg-slate-100 text-slate-500 dark:bg-slate-500/10 dark:text-slate-300" };

/** Extract a lowercase extension from a filename or URL (no leading dot). */
export function extOf(nameOrUrl: string | null | undefined): string {
  if (!nameOrUrl) return "";
  const clean = nameOrUrl.split(/[?#]/)[0];
  const base = clean.split("/").pop() ?? clean;
  const dot = base.lastIndexOf(".");
  return dot >= 0 ? base.slice(dot + 1).toLowerCase() : "";
}

export function materialMeta(nameOrUrl: string | null | undefined): MaterialMeta {
  const ext = extOf(nameOrUrl);
  const label = ext ? ext.toUpperCase() : "FILE";

  if (SLIDE_EXTS.has(ext)) return { label, category: "Slides", Icon: Presentation, ...AMBER };
  if (AUDIO_EXTS.has(ext)) return { label, category: "Audio", Icon: Music, ...VIOLET };

  // Everything else is treated as a "Document" for filtering, with its own icon/color.
  if (ext === "pdf") return { label, category: "Document", Icon: FileText, ...ROSE };
  if (ext === "doc" || ext === "docx" || ext === "rtf" || ext === "txt")
    return { label, category: "Document", Icon: FileText, ...BLUE };
  if (ext === "xls" || ext === "xlsx" || ext === "csv")
    return { label, category: "Document", Icon: Table, ...EMERALD };
  if (ext === "png" || ext === "jpg" || ext === "jpeg")
    return { label, category: "Document", Icon: ImageIcon, ...EMERALD };

  return { label, category: "Document", Icon: File, ...SLATE };
}

const CATEGORY_ORDER: MaterialCategory[] = ["Document", "Slides", "Audio"];
export function orderedCategories(present: Set<MaterialCategory>): MaterialCategory[] {
  return CATEGORY_ORDER.filter((c) => present.has(c));
}

/** "2.4 MB", "680 KB", "96 KB". Null/0 → null (caller omits the segment). */
export function formatBytes(bytes: number | null | undefined): string | null {
  if (!bytes || bytes <= 0) return null;
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${Math.round(kb)} KB`;
  const mb = kb / 1024;
  return `${mb >= 10 ? Math.round(mb) : mb.toFixed(1)} MB`;
}

/** ISO date → "Jun 3". Falls back to "" on bad input. */
export function formatShortDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
