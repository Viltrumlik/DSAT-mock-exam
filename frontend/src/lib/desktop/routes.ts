/** Where the Windows app's pages live, and the links into the app from a browser. */

export const DESKTOP_HOME = "/desktop";
export const DESKTOP_LOGIN = "/desktop/login";

/** The Windows installer, served by nginx from the shared `downloads/desktop/` folder. */
export const DESKTOP_DOWNLOAD_URL = "https://mastersat.uz/downloads/desktop/MasterSAT-Setup.exe";

/** The Mac app's disk image, next to the Windows installer. */
export const DESKTOP_MAC_DOWNLOAD_URL = "https://mastersat.uz/downloads/desktop/MasterSAT.dmg";

/**
 * Version, size and checksum of both downloads — replaced with each release, no site deploy.
 * Relative: read from the page's own origin (nginx serves `/downloads/` on mastersat.uz).
 */
export const DESKTOP_RELEASE_MANIFEST_URL = "/downloads/desktop/latest.json";

/** The download page (student area): linked from the Midterm page and the take-it-in-the-app screen. */
export const DOWNLOAD_PAGE = "/download";

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
