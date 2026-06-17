import { NextRequest, NextResponse } from "next/server";

// ---------------------------------------------------------------------------
// Console detection
// ---------------------------------------------------------------------------

function consoleFromHost(host: string | null): "admin" | "questions" | "teacher" | null {
  if (!host) return null;
  const h = host.split(":")[0].toLowerCase();
  const labels = h.split(".").filter(Boolean);
  if (!labels.length) return null;
  if (labels[0] === "admin" || h.startsWith("admin.")) return "admin";
  if (labels[0] === "questions" || h.startsWith("questions.")) return "questions";
  if (labels.length >= 2 && labels[1] === "questions") return "questions";
  if (labels[0] === "teacher" || h.startsWith("teacher.")) return "teacher";
  return null;
}

function isLocalhost(host: string | null): boolean {
  if (!host) return true;
  const h = host.split(":")[0].toLowerCase();
  return h === "localhost" || h === "127.0.0.1" || h === "0.0.0.0" || h === "[::1]";
}

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

/** Auth and account-state paths that must work on every subdomain. */
const ALWAYS_ALLOW_EXACT: Set<string> = new Set(["/login", "/register", "/frozen"]);

function isAlwaysAllowed(pathname: string): boolean {
  if (ALWAYS_ALLOW_EXACT.has(pathname)) return true;
  // Trailing-slash variants and sub-paths (e.g. /login?next=...).
  for (const p of ALWAYS_ALLOW_EXACT) {
    if (pathname.startsWith(p + "/") || pathname.startsWith(p + "?")) return true;
  }
  return false;
}

/**
 * Public static assets served from the Next.js `public/` directory.
 * These never map to page routes and must not be redirected.
 * (Next.js internals are already excluded by the matcher.)
 */
function isPublicAsset(pathname: string): boolean {
  const last = pathname.split("/").pop() ?? "";
  // Any path segment that contains a dot is treated as a file (e.g. /images/logo.png).
  return last.includes(".");
}

function startsWith(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(prefix + "/");
}

// ---------------------------------------------------------------------------
// Subdomain allowlists
// ---------------------------------------------------------------------------

/**
 * mastersat.uz (main / student portal)
 * Block staff-only routes; redirect to student home.
 */
const MAIN_BLOCKED: string[] = [
  "/admin",
  "/builder",
  "/ops",
  "/teacher",
  "/questions",
];

function isBlockedOnMain(pathname: string): boolean {
  return MAIN_BLOCKED.some((p) => startsWith(pathname, p));
}

/**
 * questions.mastersat.uz (authoring console)
 * Only authoring surfaces are allowed; everything else redirects to /builder/sets.
 * /admin is included transitionally — the monolith authoring SPA still in use.
 */
const QUESTIONS_ALLOWED: string[] = [
  "/admin",
  "/builder",
  "/questions",
];

function isAllowedOnQuestions(pathname: string): boolean {
  return QUESTIONS_ALLOWED.some((p) => startsWith(pathname, p));
}

/**
 * admin.mastersat.uz (operational console)
 * Only operational/management surfaces are allowed; everything else redirects to /ops.
 * /admin is kept for the legacy monolith during the decomposition transition period.
 * /ops is the new dedicated operations route group.
 * NOTE: /teacher is intentionally NOT allowed here — the teacher workspace now lives
 * exclusively on teacher.mastersat.uz (see the teacher console branch below).
 */
const ADMIN_ALLOWED: string[] = [
  "/admin",
  "/ops",
  "/assessments", // includes /assessments/assign
  "/classes",     // assignment/classroom detail pages
];

function isAllowedOnAdmin(pathname: string): boolean {
  return ADMIN_ALLOWED.some((p) => startsWith(pathname, p));
}

/**
 * teacher.mastersat.uz (teacher portal)
 * Only the teacher workspace is allowed; everything else redirects to /teacher.
 * Access is restricted to teacher + super_admin roles — enforced in AuthGuard
 * (client) and host_guard (server); this layer only scopes the URL surface.
 */
const TEACHER_ALLOWED: string[] = ["/teacher"];

function isAllowedOnTeacher(pathname: string): boolean {
  return TEACHER_ALLOWED.some((p) => startsWith(pathname, p));
}

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------

export function middleware(req: NextRequest) {
  const host = req.headers.get("host");
  const console = consoleFromHost(host);
  const res = NextResponse.next();
  const { pathname } = req.nextUrl;

  // ------------------------------------------------------------------
  // 1. Persist console marker cookie for client components.
  // ------------------------------------------------------------------
  if (console) {
    res.cookies.set("lms_console", console, { path: "/", sameSite: "lax" });
  } else {
    res.cookies.delete("lms_console");
  }

  // ------------------------------------------------------------------
  // 2. Bypass: local development, always-allowed paths, static assets.
  //    Order matters — check these before any redirect logic.
  // ------------------------------------------------------------------
  if (isLocalhost(host)) return res;
  if (isAlwaysAllowed(pathname)) return res;
  if (isPublicAsset(pathname)) return res;

  // ------------------------------------------------------------------
  // 3. questions.mastersat.uz — authoring console
  // ------------------------------------------------------------------
  if (console === "questions") {
    // Root redirect: land on the builder dashboard (content health overview).
    if (pathname === "/") {
      const url = req.nextUrl.clone();
      url.pathname = "/builder";
      return NextResponse.redirect(url, { headers: res.headers });
    }
    // Block non-authoring paths.
    if (!isAllowedOnQuestions(pathname)) {
      const url = req.nextUrl.clone();
      url.pathname = "/builder";
      return NextResponse.redirect(url, { headers: res.headers });
    }
    return res;
  }

  // ------------------------------------------------------------------
  // 4. admin.mastersat.uz — operational console
  // ------------------------------------------------------------------
  if (console === "admin") {
    // Root redirect: land on the new operational dashboard.
    // /admin is kept as the legacy fallback during the monolith decomposition.
    if (pathname === "/") {
      const url = req.nextUrl.clone();
      url.pathname = "/ops";
      return NextResponse.redirect(url, { headers: res.headers });
    }
    // Block non-operational paths.
    if (!isAllowedOnAdmin(pathname)) {
      const url = req.nextUrl.clone();
      url.pathname = "/ops";
      return NextResponse.redirect(url, { headers: res.headers });
    }
    return res;
  }

  // ------------------------------------------------------------------
  // 5. teacher.mastersat.uz — teacher portal
  //    Only the teacher workspace is served; everything else lands on /teacher.
  // ------------------------------------------------------------------
  if (console === "teacher") {
    if (pathname === "/") {
      const url = req.nextUrl.clone();
      url.pathname = "/teacher";
      return NextResponse.redirect(url, { headers: res.headers });
    }
    if (!isAllowedOnTeacher(pathname)) {
      const url = req.nextUrl.clone();
      url.pathname = "/teacher";
      return NextResponse.redirect(url, { headers: res.headers });
    }
    return res;
  }

  // ------------------------------------------------------------------
  // 6. Main domain (mastersat.uz) — student portal
  //    Block staff/authoring routes; redirect to student home.
  // ------------------------------------------------------------------
  if (isBlockedOnMain(pathname)) {
    const url = req.nextUrl.clone();
    url.pathname = "/";
    return NextResponse.redirect(url, { headers: res.headers });
  }

  return res;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml).*)"],
};
