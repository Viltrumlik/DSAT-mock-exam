import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Enable standalone output for PM2 deployment
  output: "standalone",

  // Don't let Next.js strip/add trailing slashes before rewrites fire —
  // Django uses APPEND_SLASH and expects them; mismatches cause redirect loops.
  skipTrailingSlashRedirect: true,

  /**
   * Paths whose screen has been retired.
   *
   * Two homework-grading screens graded alongside `/teacher/grading` until the owner asked for
   * them to go — a teacher meeting two ways to do one job has to work out which one counts.
   * The screens are deleted; these paths are not, because a path outlives the screen: a
   * bookmark, a tab left open since last week, a link in somebody's notes.
   *
   * The deep link carries a class and a homework, and the classroom's own Grading tab opens on
   * exactly that pair (`?tab=` is read by ClassroomWorkspace, `?assignment=` by the tab), so
   * the old address lands on the same homework's students rather than merely nearby. The
   * numeric constraint matters: without it a path with rubbish where an id should be would be
   * carried into the redirect and drop a teacher into a classroom that does not exist. Those
   * fall to the second rule instead, which also catches the bare hub.
   *
   * Here rather than in `middleware.ts`, which does run — verified against production, where
   * `teacher.mastersat.uz/ops` answers 307 `/teacher` — but which returns early on localhost by
   * design (`isLocalhost`). A retirement is not host policy: the screen is gone on every host
   * and in development too, and a rule nobody can reach while developing is a rule nobody
   * tests. `redirects()` is also the framework's own place for a path that has moved.
   *
   * `permanent: false` (307): a 308 is cached by browsers indefinitely, and nothing about this
   * is worth making impossible to take back.
   */
  async redirects() {
    return [
      {
        source: "/teacher/homework/grading/:classId(\\d+)/:assignmentId(\\d+)",
        destination: "/teacher/classrooms/:classId?tab=grading&assignment=:assignmentId",
        permanent: false,
      },
      {
        source: "/teacher/homework/grading/:path*",
        destination: "/teacher/grading",
        permanent: false,
      },
      {
        // The Students page shipped on main and was retired here; a class is now opened from
        // the classrooms list instead. Every link inside the app was rewired, so this catches
        // only what the app cannot reach: a bookmark, a tab left open since yesterday, a link
        // in someone's message. Without it those land on Next's bare 404 — no nav, no way
        // back — which is a worse answer than the page they were looking for having moved.
        source: "/teacher/students",
        destination: "/teacher/classrooms",
        permanent: false,
      },
    ];
  },

  // Proxy /api/* → backend in development.
  // Default: production server (real data). Override with API_PROXY_TARGET=http://localhost:8000
  // when you want to hit a local Django.
  async rewrites() {
    if (process.env.NODE_ENV !== "development") return [];
    const target = process.env.API_PROXY_TARGET || "https://mastersat.uz";
    return [
      {
        source: "/api/:path*/",
        destination: `${target}/api/:path*/`,
      },
      {
        source: "/api/:path*",
        destination: `${target}/api/:path*`,
      },
    ];
  },

  // Image optimization
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "**",
      },
      {
        protocol: "http",
        hostname: "localhost",
      },
    ],
    formats: ["image/webp", "image/avif"],
  },

  // Compress responses
  compress: true,

  // Power-optimize production builds
  experimental: {
    optimizePackageImports: ["lucide-react"],
  },
};

export default nextConfig;
