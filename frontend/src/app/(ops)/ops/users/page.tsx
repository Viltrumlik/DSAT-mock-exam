"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { usersRedirectTarget } from "@/features/ops/users/usersRedirect";

/**
 * The single Users list was split into Students, Public users and Staff (2026-10-14). This
 * address stays only so old links and bookmarks still arrive somewhere — see usersRedirect.
 * The query string is read in an effect, not through useSearchParams, so no Suspense is needed.
 */
export default function OpsUsersRedirectPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace(usersRedirectTarget(window.location.search));
  }, [router]);
  return <p className="text-[13px] text-muted-foreground">Redirecting…</p>;
}
