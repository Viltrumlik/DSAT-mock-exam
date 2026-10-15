"use client";

import { useState, type RefObject } from "react";
import Link from "next/link";
import { useQueryClient } from "@tanstack/react-query";
import { ChevronRight, LogOut, Menu } from "lucide-react";
import { authApi } from "@/lib/api";
import { OPS_SIDEBAR_ID } from "./OpsSidebar";
import { OPS_CONSOLE, sectionFor, type ConsoleConfig } from "./opsNav";

/** `useMe` types the payload as an open record, so the fields are narrowed here. */
type MeLike = Record<string, unknown> | null | undefined;

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

/** "First Last", else the username, else the email — whatever the account has. */
export function opsDisplayName(me: MeLike): string {
  if (!me) return "";
  const full = [str(me.first_name), str(me.last_name)].filter(Boolean).join(" ");
  return full || str(me.username) || str(me.email);
}

/**
 * The bar across the top of the content column: the hamburger (below `lg` only), the
 * breadcrumb "Admin › <section>" (the builder: "Builder › <section>"), and the signed-in user with Log out.
 */
export function OpsTopBar({
  pathname,
  me,
  mobileOpen,
  onOpenMobile,
  menuButtonRef,
  config = OPS_CONSOLE,
}: {
  pathname: string;
  me: MeLike;
  mobileOpen: boolean;
  onOpenMobile: () => void;
  menuButtonRef?: RefObject<HTMLButtonElement | null>;
  /** Which console this bar belongs to — its home, its first crumb, its nav. */
  config?: Pick<ConsoleConfig, "root" | "crumb" | "groups">;
}) {
  const queryClient = useQueryClient();
  const [loggingOut, setLoggingOut] = useState(false);
  const section = sectionFor(pathname, config.groups, config.root);
  const name = opsDisplayName(me);
  const atSection = section ? pathname === section.href : false;

  return (
    <header className="sticky top-0 z-20 flex h-12 shrink-0 items-center gap-2 border-b border-border bg-card px-4 md:px-6">
      <button
        ref={menuButtonRef}
        type="button"
        onClick={onOpenMobile}
        aria-label="Open menu"
        aria-controls={OPS_SIDEBAR_ID}
        aria-expanded={mobileOpen}
        className="-ml-1.5 grid h-8 w-8 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-surface-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary lg:hidden"
      >
        <Menu className="h-5 w-5" />
      </button>

      <nav aria-label="Breadcrumb" className="min-w-0 flex-1">
        <ol className="flex min-w-0 items-center gap-1 text-[13px]">
          <li className="shrink-0">
            <Link
              href={config.root}
              className="rounded-sm text-muted-foreground hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              {config.crumb}
            </Link>
          </li>
          {section ? (
            <>
              <li aria-hidden className="shrink-0 text-muted-foreground">
                <ChevronRight className="h-3.5 w-3.5" />
              </li>
              <li className="min-w-0 truncate">
                {atSection ? (
                  <span aria-current="page" className="font-semibold text-foreground">
                    {section.label}
                  </span>
                ) : (
                  <Link
                    href={section.href}
                    className="rounded-sm font-semibold text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  >
                    {section.label}
                  </Link>
                )}
              </li>
            </>
          ) : null}
        </ol>
      </nav>

      <div className="flex shrink-0 items-center gap-1 md:gap-3">
        {name ? (
          <span className="hidden max-w-[16rem] truncate text-[13px] text-muted-foreground sm:inline" title={name}>
            {name}
          </span>
        ) : null}
        <button
          type="button"
          disabled={loggingOut}
          onClick={() => {
            setLoggingOut(true);
            void authApi.logout(queryClient);
          }}
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border px-2.5 text-[13px] font-medium text-foreground transition-colors hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-60"
        >
          <LogOut aria-hidden className="h-3.5 w-3.5" />
          Log out
        </button>
      </div>
    </header>
  );
}
