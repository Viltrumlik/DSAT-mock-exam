import { NextRequest, NextResponse } from "next/server";
import { getConsoleFromHostHeader } from "@/lib/hostConsole";

export function middleware(req: NextRequest) {
  const host = req.headers.get("host");
  const console = getConsoleFromHostHeader(host);
  const res = NextResponse.next();
  const pathname = req.nextUrl.pathname;

  // Persist a small, explicit console marker for client components.
  if (console) {
    res.cookies.set("lms_console", console, { path: "/", sameSite: "lax" });
  } else {
    res.cookies.delete("lms_console");
  }

  // Questions console: dedicated Question Bank only.
  if (console === "questions") {
    const allowPrefixes = [
      "/",
      "/questions/bank",
      "/vocabulary/admin",
      "/login",
      "/register",
      "/security",
      "/frozen",
      "/_not-found",
    ];
    const allowed = allowPrefixes.some((p) => pathname === p || pathname.startsWith(p + "/"));

    if (!allowed) {
      const url = req.nextUrl.clone();
      url.pathname = "/";
      url.search = "";
      return NextResponse.redirect(url, { headers: res.headers });
    }
  }

  // Admin console can continue to land on /admin.
  if (console === "admin" && pathname === "/") {
    const url = req.nextUrl.clone();
    url.pathname = "/admin";
    return NextResponse.redirect(url, { headers: res.headers });
  }

  return res;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml).*)"],
};
