"use client";

import { createContext, useContext, type ReactNode } from "react";

/**
 * The typeface an overlay is set in.
 *
 * Modal, Drawer and the classroom Dialog portal onto `<body>`, and the toast stack is rendered by the
 * root layout, above every shell. Either way they sit outside whatever set the page's face — the app
 * shell's `ds-app`, a page's own Plus Jakarta — and `<body>` is Georgia, the reading serif kept for
 * passages. So they all read in Georgia, down to their buttons: the `button { font-family:
 * var(--font-sans) }` rule in globals.css does not catch them, because `--font-sans` is declared on
 * `:root`, where next/font's `--font-geist-sans` is not defined, and so resolves to nothing.
 *
 * An overlay therefore wears `ds-app`, the UI sans, unless it opens inside a surface set in the body's
 * face. The staff consoles moved to the sans with the redesign's shell (`.ms`) and deleted their
 * providers; what still reads in Georgia — the Builder's full-screen editors, which show a question
 * as the student sees it — wraps itself in `<OverlayFaceProvider face="body">`, so its overlays match
 * the page they open over.
 *
 * Reading text that must stay serif inside an overlay says so itself (`font-[Georgia]`, as the
 * question review does), and wins over the inherited sans.
 */
export type OverlayFace = "ui" | "body";

const OverlayFaceContext = createContext<OverlayFace>("ui");

export function OverlayFaceProvider({ face, children }: { face: OverlayFace; children: ReactNode }) {
  return <OverlayFaceContext.Provider value={face}>{children}</OverlayFaceContext.Provider>;
}

export function useOverlayFace(): OverlayFace {
  return useContext(OverlayFaceContext);
}

/** The class that sets an overlay in `face`. It goes on the element the overlay puts on `<body>`. */
export function overlayFaceClass(face: OverlayFace): string | undefined {
  return face === "ui" ? "ds-app" : undefined;
}

export function useOverlayFaceClass(): string | undefined {
  return overlayFaceClass(useOverlayFace());
}
