"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BookMarked, FolderKanban } from "lucide-react";
import { cn } from "@/lib/cn";

const items = [
  { href: "/", label: "Question bank", icon: FolderKanban, match: (p: string) => p === "/" || p.startsWith("/questions/") },
  { href: "/vocabulary/admin", label: "Vocabulary", icon: BookMarked, match: (p: string) => p.startsWith("/vocabulary/admin") },
];

export default function QuestionsConsoleChrome({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="flex min-h-[100dvh] flex-col bg-background text-foreground">
      <header className="sticky top-0 z-40 border-b border-border bg-card/95 backdrop-blur-xl">
        <div className="mx-auto flex max-w-6xl flex-col gap-3 px-4 py-3 md:flex-row md:items-center md:justify-between md:py-3.5">
          <div className="flex min-w-0 items-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/images/logo.png" alt="" className="h-9 w-9 shrink-0 rounded-lg bg-background/80 object-contain p-0.5 ring-1 ring-border" />
            <div className="min-w-0">
              <p className="text-[10px] font-extrabold uppercase tracking-[0.14em] text-ds-gold">Questions console</p>
              <p className="truncate text-sm font-bold text-foreground">Authoring</p>
            </div>
          </div>
          <nav className="flex flex-wrap gap-2" aria-label="Questions console">
            {items.map(({ href, label, icon: Icon, match }) => {
              const active = match(pathname);
              return (
                <Link
                  key={href}
                  href={href}
                  className={cn(
                    "inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold transition-colors",
                    active
                      ? "bg-primary/12 text-foreground ring-1 ring-primary/30"
                      : "text-muted-foreground hover:bg-surface-2 hover:text-foreground",
                  )}
                >
                  <Icon className="h-4 w-4 shrink-0 opacity-90" />
                  {label}
                </Link>
              );
            })}
          </nav>
        </div>
      </header>
      <main className="flex-1">{children}</main>
    </div>
  );
}
