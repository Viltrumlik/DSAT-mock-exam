"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { useMe } from "@/hooks/useMe";

/** If auth is still BOOTING after this many ms, force-redirect to /login rather than spinning forever. */
const BOOT_TIMEOUT_MS = 12_000;

function consoleFromHostname(): "admin" | "questions" | "main" {
    if (typeof window === "undefined") return "main";
    const h = String(window.location.hostname || "").toLowerCase();
    const labels = h.split(".").filter(Boolean);
    if (!labels.length) return "main";
    if (labels[0] === "admin" || h.startsWith("admin.")) return "admin";
    if (labels[0] === "questions" || h.startsWith("questions.")) return "questions";
    if (labels.length >= 2 && labels[1] === "questions") return "questions";
    return "main";
}

function permissionList(me: Record<string, unknown> | undefined | null): string[] {
    if (!me) return [];
    const p = me.permissions;
    if (!Array.isArray(p)) return [];
    return p.filter((x): x is string => typeof x === "string");
}

function staffAccess(perms: string[]): boolean {
    return (
        perms.includes("*") ||
        perms.includes("manage_users") ||
        perms.includes("assign_access") ||
        perms.includes("manage_tests")
    );
}

/**
 * `isOptional`: public shell (Marketing / browse) — never blocks on `/users/me`.
 * Strict guards: session required; `UNAUTHENTICATED` redirects to `/login` (`useMe` may set session notice → login page).
 *
 * Permission fields on `me` are **UX hints only** — backend remains authoritative on every mutation.
 */
export default function AuthGuard({
    children,
    isOptional = false,
    adminOnly = false,
}: {
    children: React.ReactNode;
    isOptional?: boolean;
    adminOnly?: boolean;
}) {
    const router = useRouter();
    const { bootState, me } = useMe();
    const bootTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // Safety net: if BOOTING for too long (e.g. a stuck promise), force redirect to login.
    useEffect(() => {
        if (isOptional) return;
        if (bootState === "BOOTING") {
            bootTimerRef.current = setTimeout(() => {
                // Still booting after timeout — something is stuck; go to login.
                window.location.href = "/login";
            }, BOOT_TIMEOUT_MS);
        } else {
            if (bootTimerRef.current !== null) {
                clearTimeout(bootTimerRef.current);
                bootTimerRef.current = null;
            }
        }
        return () => {
            if (bootTimerRef.current !== null) {
                clearTimeout(bootTimerRef.current);
                bootTimerRef.current = null;
            }
        };
    }, [bootState, isOptional]);

    const consoleMode = consoleFromHostname();

    const roleRaw = String(me?.role ?? "").trim().toLowerCase();
    const perms = permissionList(me);
    const frozen = !!me?.is_frozen;
    const isTester = roleRaw === "test_admin";
    const isStudent = roleRaw === "student";
    const hasStaff = staffAccess(perms);

    useEffect(() => {
        if (bootState !== "AUTHENTICATED" || !me) return;
        if (frozen && !hasStaff) {
            router.replace("/frozen");
            return;
        }
        if (consoleMode === "questions" && isStudent) {
            router.replace("/");
            return;
        }
        if (consoleMode === "admin" && (isStudent || isTester)) {
            router.replace("/");
            return;
        }
        if (adminOnly && (!hasStaff || (consoleMode === "admin" && isTester))) {
            router.replace("/");
            return;
        }
    }, [
        bootState,
        me,
        frozen,
        hasStaff,
        isStudent,
        isTester,
        adminOnly,
        consoleMode,
        router,
    ]);

    useEffect(() => {
        if (isOptional || bootState !== "UNAUTHENTICATED") return;
        router.replace("/login");
    }, [isOptional, bootState, router]);

    if (isOptional) {
        return <>{children}</>;
    }

    if (bootState === "BOOTING") {
        return (
            <div className="min-h-screen bg-background flex items-center justify-center">
                <Loader2 className="h-10 w-10 animate-spin text-primary/60" aria-label="Loading" />
            </div>
        );
    }

    if (bootState === "UNAUTHENTICATED") {
        return (
            <div className="min-h-screen bg-background flex items-center justify-center">
                <Loader2 className="h-10 w-10 animate-spin text-primary/60" aria-label="Redirecting" />
            </div>
        );
    }

    if (!me) {
        return (
            <div className="min-h-screen bg-background flex flex-col items-center justify-center gap-4 px-6">
                <p className="text-sm text-muted-foreground text-center max-w-md">
                    Session could not be verified.
                </p>
                <Link href="/login" className="text-sm font-semibold text-primary underline">
                    Sign in
                </Link>
            </div>
        );
    }

    const willRedirectAway =
        (frozen && !hasStaff) ||
        (consoleMode === "questions" && isStudent) ||
        (consoleMode === "admin" && (isStudent || isTester)) ||
        (adminOnly && (!hasStaff || (consoleMode === "admin" && isTester)));

    if (willRedirectAway) {
        return (
            <div className="min-h-screen bg-background flex items-center justify-center">
                <Loader2 className="h-8 w-8 animate-spin text-primary/60" aria-label="Redirecting" />
            </div>
        );
    }

    return <>{children}</>;
}
