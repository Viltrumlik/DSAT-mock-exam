/**
 * StateTag — Centralized platform state visibility system.
 *
 * ARCHITECTURE NOTE:
 *   Every state badge rendered anywhere in this platform MUST route through
 *   this component. No ad-hoc "bg-green-100 text-green-800" badge logic is
 *   permitted outside this file for states in the STATE_VOCABULARY below.
 *
 * OPERATIONAL COGNITION PRINCIPLE:
 *   States are not cosmetic labels. They communicate:
 *   - Whether content is safe to edit (DRAFT/REVIEW_READY vs PUBLISHED/IN_USE)
 *   - Whether a record is the canonical live version (ACTIVE/PUBLISHED)
 *   - Whether a record is historically preserved and must not be mutated (HISTORICAL/SUPERSEDED)
 *   - Whether an async operation is in-flight (SCORING/RETRYING)
 *   - Whether an operation failed and requires intervention (FAILED)
 *
 * ADDING NEW STATES:
 *   1. Add a key to PlatformState
 *   2. Add a StateSpec entry in STATE_VOCABULARY
 *   3. DO NOT add a new badge component elsewhere — extend this one.
 */

import type { LucideIcon } from "lucide-react";
import {
  FileEdit,
  Eye,
  CheckCircle2,
  Zap,
  Link2,
  Clock3,
  GitBranch,
  Archive,
  Loader2,
  XCircle,
  RotateCcw,
  AlertCircle,
  Lock,
} from "lucide-react";
import { cn } from "@/lib/cn";

// ─── State vocabulary ────────────────────────────────────────────────────────

/**
 * All first-class platform states that can appear as tags/badges.
 * Organized by domain applicability for documentation clarity.
 */
export type PlatformState =
  // Content authoring states (assessment sets, questions)
  | "DRAFT"
  | "REVIEW_READY"
  | "PUBLISHED"
  | "SUPERSEDED"
  | "HISTORICAL"
  | "ARCHIVED"
  // Question usage states
  | "FREE"
  | "IN_USE"
  | "RETIRED"
  // Assignment/classroom states
  | "ACTIVE"
  | "SCHEDULED"
  | "COMPLETED"
  | "CANCELLED"
  // Async operation states
  | "SCORING"
  | "SCORED"
  | "FAILED"
  | "RETRYING";

type StateSpec = {
  /** Human-readable label shown in the badge */
  label: string;
  /** Full semantic description for tooltips / screen readers */
  description: string;
  /** Lucide icon */
  icon: LucideIcon;
  /** Tailwind classes: background + text color */
  classes: string;
  /** Whether this state implies immutability (content must not be edited) */
  immutable: boolean;
};

export const STATE_VOCABULARY: Record<PlatformState, StateSpec> = {
  // ── Content authoring ──
  DRAFT: {
    label: "Draft",
    description: "Work in progress. Not visible to students. Safe to edit.",
    icon: FileEdit,
    classes: "bg-slate-100 text-slate-700",
    immutable: false,
  },
  REVIEW_READY: {
    label: "Review ready",
    description: "Flagged for review before publishing. Not yet live.",
    icon: Eye,
    classes: "bg-indigo-100 text-indigo-800",
    immutable: false,
  },
  PUBLISHED: {
    label: "Published",
    description:
      "Live canonical version. Immutable — edits require creating a new revision.",
    icon: CheckCircle2,
    classes: "bg-emerald-100 text-emerald-800",
    immutable: true,
  },
  SUPERSEDED: {
    label: "Superseded",
    description:
      "Replaced by a newer published version. Historical assignments still reference this snapshot.",
    icon: GitBranch,
    classes: "bg-violet-100 text-violet-700",
    immutable: true,
  },
  HISTORICAL: {
    label: "Historical",
    description:
      "Preserved for exam review and audit. Must not be modified. Students who took this version see it frozen.",
    icon: Lock,
    classes: "bg-amber-100 text-amber-800",
    immutable: true,
  },
  ARCHIVED: {
    label: "Archived",
    description:
      "Retired from active use. Academic record preserved per governance policy. Not assignable.",
    icon: Archive,
    classes: "bg-gray-100 text-gray-500",
    immutable: true,
  },

  // ── Question usage ──
  FREE: {
    label: "Free",
    description: "Not currently referenced by any published assessment set. Safe to edit.",
    icon: FileEdit,
    classes: "bg-slate-100 text-slate-600",
    immutable: false,
  },
  IN_USE: {
    label: "In use",
    description:
      "Referenced by one or more published assessment sets. Edits create a new question revision; original is preserved in snapshots.",
    icon: Link2,
    classes: "bg-blue-100 text-blue-800",
    immutable: true,
  },
  RETIRED: {
    label: "Retired",
    description:
      "No longer in use. Preserved for historical reference. Historical assignments that included this question are unaffected.",
    icon: Archive,
    classes: "bg-gray-100 text-gray-500",
    immutable: true,
  },

  // ── Assignment / classroom ──
  ACTIVE: {
    label: "Active",
    description: "Live and accepting student submissions.",
    icon: Zap,
    classes: "bg-emerald-100 text-emerald-800",
    immutable: false,
  },
  SCHEDULED: {
    label: "Scheduled",
    description: "Scheduled to open at a future date.",
    icon: Clock3,
    classes: "bg-sky-100 text-sky-800",
    immutable: false,
  },
  COMPLETED: {
    label: "Completed",
    description: "Submission window closed. All results are final.",
    icon: CheckCircle2,
    classes: "bg-teal-100 text-teal-800",
    immutable: true,
  },
  CANCELLED: {
    label: "Cancelled",
    description: "Cancelled before completion. No submissions recorded.",
    icon: XCircle,
    classes: "bg-red-100 text-red-700",
    immutable: true,
  },

  // ── Async operations ──
  SCORING: {
    label: "Scoring",
    description: "AI scoring in progress. Results will appear shortly.",
    icon: Loader2,
    classes: "bg-blue-100 text-blue-700",
    immutable: false,
  },
  SCORED: {
    label: "Scored",
    description: "Scoring complete. Results are available.",
    icon: CheckCircle2,
    classes: "bg-emerald-100 text-emerald-800",
    immutable: true,
  },
  FAILED: {
    label: "Failed",
    description: "Operation failed. Requires manual intervention.",
    icon: AlertCircle,
    classes: "bg-red-100 text-red-800",
    immutable: false,
  },
  RETRYING: {
    label: "Retrying",
    description: "Automatically retrying after a transient failure.",
    icon: RotateCcw,
    classes: "bg-amber-100 text-amber-700",
    immutable: false,
  },
};

// ─── Component ───────────────────────────────────────────────────────────────

type Size = "xs" | "sm" | "md";

const SIZE_CLASSES: Record<Size, { badge: string; icon: string; spinner: string }> = {
  xs: { badge: "px-1.5 py-0.5 text-[9px] gap-1", icon: "h-2.5 w-2.5", spinner: "h-2.5 w-2.5" },
  sm: { badge: "px-2 py-0.5 text-[10px] gap-1", icon: "h-3 w-3", spinner: "h-3 w-3" },
  md: { badge: "px-2.5 py-1 text-xs gap-1.5", icon: "h-3.5 w-3.5", spinner: "h-3.5 w-3.5" },
};

type Props = {
  state: PlatformState;
  size?: Size;
  /** Show the icon alongside the label */
  showIcon?: boolean;
  /** Override the label (use sparingly — breaks vocabulary consistency) */
  labelOverride?: string;
  className?: string;
};

/**
 * StateTag renders a pill badge for any first-class platform state.
 *
 * Usage:
 *   <StateTag state="PUBLISHED" />
 *   <StateTag state="IN_USE" size="xs" />
 *   <StateTag state="DRAFT" showIcon size="md" />
 */
export function StateTag({
  state,
  size = "sm",
  showIcon = true,
  labelOverride,
  className,
}: Props) {
  const spec = STATE_VOCABULARY[state];
  const sizes = SIZE_CLASSES[size];
  const Icon = spec.icon;
  const isSpinner = state === "SCORING" || state === "RETRYING";

  return (
    <span
      title={spec.description}
      aria-label={`${spec.label}: ${spec.description}`}
      className={cn(
        "inline-flex items-center rounded-lg font-black uppercase tracking-wide",
        sizes.badge,
        spec.classes,
        className,
      )}
    >
      {showIcon && (
        <Icon
          className={cn(
            sizes.icon,
            "shrink-0",
            isSpinner && "animate-spin",
          )}
          aria-hidden
        />
      )}
      {labelOverride ?? spec.label}
    </span>
  );
}

// ─── Immutability lock indicator ─────────────────────────────────────────────

/**
 * ImmutableIndicator — small lock icon shown next to immutable content.
 * Use when the StateTag alone doesn't make immutability obvious in context.
 */
export function ImmutableIndicator({ className }: { className?: string }) {
  return (
    <Lock
      className={cn("h-3 w-3 text-muted-foreground shrink-0", className)}
      title="This content is immutable and cannot be edited"
      aria-label="Immutable"
    />
  );
}

// ─── Version chip ─────────────────────────────────────────────────────────────

type VersionChipProps = {
  version: number | string;
  /** If true, renders as the active/latest version */
  isCurrent?: boolean;
  className?: string;
};

/**
 * VersionChip — renders a compact "v{N}" chip.
 * Use next to assessment set titles and assignment snapshot references.
 *
 * Examples:
 *   <VersionChip version={3} isCurrent />    → "v3 · current" (emerald)
 *   <VersionChip version={2} />              → "v2" (gray)
 */
export function VersionChip({ version, isCurrent, className }: VersionChipProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wide font-mono",
        isCurrent
          ? "bg-emerald-100 text-emerald-800"
          : "bg-slate-100 text-slate-500",
        className,
      )}
    >
      v{version}
      {isCurrent && (
        <span className="text-[8px] font-bold normal-case tracking-normal opacity-70">
          · current
        </span>
      )}
    </span>
  );
}

// ─── Snapshot pin indicator ───────────────────────────────────────────────────

type SnapshotPinProps = {
  /** Published date of the pinned snapshot */
  publishedAt: string;
  /** Version number */
  version?: number | string;
  /** Question count at publish time */
  questionCount?: number;
  className?: string;
};

/**
 * SnapshotPin — shows that an assignment is pinned to a historical snapshot.
 * Renders below assignment titles in lists and on assignment detail pages.
 *
 * Example:
 *   <SnapshotPin publishedAt="2025-03-01T00:00:00Z" version={2} questionCount={44} />
 */
export function SnapshotPin({ publishedAt, version, questionCount, className }: SnapshotPinProps) {
  const date = new Date(publishedAt).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-[10px] text-muted-foreground font-semibold",
        className,
      )}
      title="This assignment is pinned to a historical snapshot. Students see the version published on this date."
    >
      <Lock className="h-2.5 w-2.5 shrink-0" aria-hidden />
      Snapshot{version != null ? ` v${version}` : ""} · {date}
      {questionCount != null && ` · ${questionCount}q`}
    </span>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Returns true if the given state implies immutability. */
export function isImmutableState(state: PlatformState): boolean {
  return STATE_VOCABULARY[state].immutable;
}

/** Returns the human-readable label for a state. */
export function stateLabel(state: PlatformState): string {
  return STATE_VOCABULARY[state].label;
}

/** Returns the semantic description for a state. */
export function stateDescription(state: PlatformState): string {
  return STATE_VOCABULARY[state].description;
}
