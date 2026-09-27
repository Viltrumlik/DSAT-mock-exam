"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent, ReactNode } from "react";
import { Button } from "./primitives";
import { CARD_SURFACE } from "./tones";

/**
 * The widths a caller may ask for, named the way `components/ui/Modal` names them so a reader
 * moving between the two kits meets one vocabulary. `md` is the one-decision dialog and the
 * default, so no existing caller moves; `xl` is a reading width, enough for a whole question
 * with a figure in it. A closed set rather than a free number because twenty pages each picking
 * their own width is how this panel drifted into three looks the first time.
 */
const SIZE_WIDTH = { sm: 360, md: 440, lg: 680, xl: 1040 } as const;

export type DialogSize = keyof typeof SIZE_WIDTH;

/**
 * What Tab is allowed to land on, in DOM order. `:not([disabled])` carries more weight than it
 * looks: `busy` disables both buttons mid-request, and a trap that still counted them would
 * park a teacher on a control that cannot be pressed and looks like the dialog has hung.
 */
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * A modal with one decision in it. Escape and the backdrop both close it, and neither confirms —
 * a destructive action is never one stray click away.
 *
 * It is portalled onto `<body>`, and the portal's own root carries `.dzboard`. Both halves are
 * load-bearing, and removing either looks like a simplification right up until it isn't:
 *
 * · `position: fixed` resolves against the nearest ancestor carrying a transform, a filter or
 *   paint containment, not against the viewport. This panel is full of them — `.dz-rise` and
 *   `.dz-pop` end on `transform: … both`, which pins a non-`none` matrix forever, and
 *   `.dz-card:hover` adds one while the pointer rests on the card the dialog was opened from.
 *   Rendered in place, `inset: 0` then means "this card", so the modal centres inside a box
 *   taller than the screen and can open below the fold, looking like nothing happened.
 * · Every colour below is a `--dz-*` custom property, and those are declared by the `.dzboard`
 *   scope that `TeacherPage` puts around the page. Escaping that scope is precisely what a
 *   portal to `<body>` does, so the scope has to travel with it or the modal renders with no
 *   colours at all. `.dark .dzboard` keeps matching through the portal, because next-themes
 *   puts `.dark` on `<html>` — above `<body>`, and so above the portal root too.
 */
export function Dialog({
  open, title, description, children, confirmLabel = "Confirm", cancelLabel = "Cancel",
  tone = "primary", size = "md", busy = false, onConfirm, onClose,
}: {
  open: boolean;
  title: string;
  description?: string;
  children?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: "primary" | "danger";
  size?: DialogSize;
  busy?: boolean;
  onConfirm?: () => void;
  onClose: () => void;
}) {
  const headingId = useId();
  const descriptionId = useId();
  const panel = useRef<HTMLDivElement | null>(null);
  const pressStartedOnBackdrop = useRef(false);

  /**
   * `createPortal` needs a real `<body>`, and Next renders this on the server first. Waiting
   * for a mount is how the rest of the app defers client-only work (`components/ui/Modal`,
   * `components/ui/Drawer`), and it is deliberately not a `typeof document` check: that would
   * let the first client render differ from the server's, which is a hydration mismatch.
   */
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !busy) onClose(); };
    // Bound to `document`, per open dialog, on purpose: two stacked dialogs both hear Escape
    // and both close, which is the behaviour this panel already has and callers rely on.
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, busy, onClose]);

  /**
   * Focus moves to the panel itself rather than to a button. The panel is labelled by the
   * heading and described by the line under it, so a screen reader reads the decision before
   * it reads any control — and, unlike landing on Confirm, a stray Enter on arrival cannot
   * fire something destructive. Putting focus back where it came from is the other half: drop
   * it and a keyboard user is returned to the top of the document and has to walk the whole
   * page again to reach the row they opened this from.
   */
  useEffect(() => {
    if (!open || !mounted) return;
    const previous = document.activeElement as HTMLElement | null;
    panel.current?.focus();
    return () => previous?.focus?.();
  }, [open, mounted]);

  // Disabling the element that holds focus drops it to `<body>` in every browser, and `busy`
  // disables both buttons mid-request — so without this the teacher is standing on the page
  // behind an open modal, outside the trap, until the request comes back.
  useEffect(() => {
    if (!open || !busy) return;
    const root = panel.current;
    if (root && !root.contains(document.activeElement)) root.focus();
  }, [open, busy]);

  /** Tab and Shift+Tab wrap at the ends instead of walking out onto the page underneath. */
  function trapTab(e: ReactKeyboardEvent<HTMLDivElement>) {
    if (e.key !== "Tab") return;
    const root = panel.current;
    if (!root) return;
    const stops = [...root.querySelectorAll<HTMLElement>(FOCUSABLE)];
    // Mid-request there is nothing left to land on. Tab still must not leave.
    if (stops.length === 0) { e.preventDefault(); root.focus(); return; }
    const at = stops.indexOf(document.activeElement as HTMLElement);
    const edge = e.shiftKey ? 0 : stops.length - 1;
    // Anywhere but an edge, the browser's own order is already right. -1 is the panel itself,
    // which is where focus starts, so it enters the ring from whichever end Tab was aimed at.
    if (at !== -1 && at !== edge) return;
    e.preventDefault();
    stops[e.shiftKey ? stops.length - 1 : 0].focus();
  }

  /**
   * A click fires on the nearest common ancestor of press and release, so selecting text in
   * the description and letting go a few pixels outside used to land a `click` on the backdrop
   * and throw the teacher's work away. Close only on a press that both began and ended out here.
   */
  function pressBackdrop(e: ReactMouseEvent<HTMLDivElement>) {
    pressStartedOnBackdrop.current = e.target === e.currentTarget;
  }

  function releaseBackdrop(e: ReactMouseEvent<HTMLDivElement>) {
    const bothEnds = pressStartedOnBackdrop.current && e.target === e.currentTarget;
    pressStartedOnBackdrop.current = false;
    if (bothEnds && !busy) onClose();
  }

  if (!mounted || !open) return null;

  return createPortal(
    // The token scope, carried to the portal. `display: contents` so the carrier itself never
    // becomes a box in `<body>`'s layout — it exists only to hold the class.
    <div className="dzboard" style={{ display: "contents" }}>
      <div
        role="presentation"
        onMouseDown={pressBackdrop}
        onClick={releaseBackdrop}
        style={{
          position: "fixed", inset: 0, zIndex: 60, display: "flex",
          alignItems: "center", justifyContent: "center", padding: 16,
          background: "rgba(15,23,41,.45)",
        }}
      >
        <div
          ref={panel}
          role="dialog"
          aria-modal="true"
          aria-labelledby={headingId}
          aria-describedby={description ? descriptionId : undefined}
          // Focused on open, so it needs a tab stop; `-1` keeps it out of the Tab ring itself,
          // and the ring is suppressed because this focus is programmatic — a halo around the
          // whole card would read as "you are here" on something nobody aimed at.
          tabIndex={-1}
          onKeyDown={trapTab}
          // Not redundant next to the target check above: a portal bubbles its events through
          // the REACT tree, not the DOM one, so a click on Cancel is still a click on whatever
          // the caller mounted this from — a row that opens a pop-up would reopen it.
          onClick={(e) => e.stopPropagation()}
          style={{
            ...CARD_SURFACE, width: "100%", maxWidth: SIZE_WIDTH[size], padding: "26px 28px",
            boxShadow: "0 24px 60px rgba(15,23,41,.18)", outline: "none",
            // A dialog taller than the screen has no way out of its own bottom half.
            maxHeight: "min(88vh, 980px)", overflowY: "auto",
          }}
        >
          <h2 id={headingId} style={{ fontSize: 19, fontWeight: 800, letterSpacing: "-.01em", color: "var(--dz-ink)", margin: 0 }}>{title}</h2>
          {description && <p id={descriptionId} style={{ fontSize: 14, color: "var(--dz-mute)", marginTop: 8 }}>{description}</p>}
          {children && <div style={{ marginTop: 16 }}>{children}</div>}
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 22 }}>
            <Button variant="ghost" onClick={onClose} disabled={busy}>{cancelLabel}</Button>
            {onConfirm && (
              <Button variant={tone === "danger" ? "danger" : "primary"} onClick={onConfirm} busy={busy}>
                {confirmLabel}
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
