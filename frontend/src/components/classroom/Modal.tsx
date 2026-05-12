import { cn } from "@/lib/cn";
import { X } from "lucide-react";
import type { ReactNode } from "react";
import { ClassroomButton } from "./Button";

export type ClassroomModalProps = {
  open: boolean;
  onClose: () => void;
  titleId: string;
  eyebrow?: string;
  title: string;
  description?: string;
  children: ReactNode;
  /** Optional footer row (e.g. form actions). */
  footer?: ReactNode;
  size?: "md" | "lg";
  className?: string;
};

export function ClassroomModal({
  open,
  onClose,
  titleId,
  eyebrow,
  title,
  description,
  children,
  footer,
  size = "md",
  className,
}: ClassroomModalProps) {
  if (!open) return null;

  const maxW = size === "lg" ? "max-w-3xl" : "max-w-2xl";

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 sm:p-6" role="presentation">
      <button
        type="button"
        className="absolute inset-0 bg-[var(--overlay-scrim)][8px] transition-opacity duration-200"
        aria-label="Close dialog"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={cn(
          "relative flex max-h-[min(90vh,880px)] w-full flex-col overflow-hidden rounded-[1.25rem] border border-border bg-card shadow-2xl",
          "animate-[ds-modal-in_0.22s_cubic-bezier(0.16,1,0.3,1)]",
          maxW,
          className,
        )}
      >
        <header className="cr-modal-header shrink-0 border-b border-border px-6 py-5">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              {eyebrow ? (
                <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-primary">{eyebrow}</p>
              ) : null}
              <h2 id={titleId} className="mt-1 text-lg font-extrabold tracking-tight text-foreground sm:text-xl">
                {title}
              </h2>
              {description ? (
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{description}</p>
              ) : null}
            </div>
            <ClassroomButton
              variant="ghost"
              size="sm"
              className="shrink-0 !p-2"
              onClick={onClose}
              aria-label="Close"
            >
              <X className="h-5 w-5" />
            </ClassroomButton>
          </div>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 py-6">{children}</div>
        {footer ? (
          <footer className="shrink-0 border-t border-border px-6 py-4">{footer}</footer>
        ) : null}
      </div>
    </div>
  );
}
