/** Where the Windows app's pages live, and the links into the app from a browser. */

export const DESKTOP_HOME = "/desktop";
export const DESKTOP_LOGIN = "/desktop/login";

/** The installer, served by nginx from the release's `downloads/desktop/` folder. */
export const DESKTOP_DOWNLOAD_URL = "https://mastersat.uz/downloads/desktop/MasterSAT-Setup.exe";

export type DesktopPaperKind = "midterm" | "pastpaper";

/** The app's "You're all finished!" page for a paper. */
export function desktopDonePath(kind: DesktopPaperKind, attemptId: number): string {
  return `/desktop/done/${kind}/${attemptId}`;
}

/**
 * A link that opens a page of this site inside the app (the `mastersat://` scheme the
 * installer registers). The app only follows paths on its own allowlist.
 */
export function openInAppLink(path: string): string {
  return `mastersat://open?path=${encodeURIComponent(path)}`;
}
