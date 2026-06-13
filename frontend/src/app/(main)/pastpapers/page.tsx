"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { examsPublicApi, type PastpaperPackPublic } from "@/lib/api";
import { BookOpen, Calculator, Calendar, ChevronRight, FileText, Globe, Search } from "lucide-react";
import { Card, CardContent, Badge, Input, Stat, EmptyState, Alert, Skeleton } from "@/components/ui";

function formatDate(s: string | null): string {
  if (!s) return "Undated";
  try {
    return new Date(s).toLocaleDateString("en-US", { month: "long", year: "numeric" });
  } catch {
    return s;
  }
}

function PackCard({ pack }: { pack: PastpaperPackPublic }) {
  const rwSection = pack.sections.find(
    (s) => s.subject === "READING_WRITING" || s.subject?.toLowerCase().includes("reading"),
  );
  const mathSection = pack.sections.find(
    (s) => s.subject === "MATH" || s.subject?.toLowerCase().includes("math"),
  );

  return (
    <Link href={`/pastpapers/${pack.id}`} className="ds-ring block rounded-2xl">
      <Card variant="interactive">
        <CardContent className="flex items-center gap-4 py-4">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary-soft text-primary">
            <FileText className="h-6 w-6" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="mb-1 flex flex-wrap items-center gap-2">
              <Badge variant={pack.form_type === "US" ? "info" : "accent"}>
                <Globe className="h-3 w-3" />
                {pack.form_type === "US" ? "US" : "International"}
              </Badge>
              {pack.label ? <span className="text-[11px] font-bold text-muted-foreground">Form {pack.label}</span> : null}
            </div>
            <h2 className="truncate text-sm font-bold text-foreground">
              {pack.title || `SAT past paper — ${formatDate(pack.practice_date)}`}
            </h2>
            <div className="mt-1.5 flex flex-wrap items-center gap-2">
              <span className="flex items-center gap-1 text-[11px] font-semibold text-muted-foreground">
                <Calendar className="h-3 w-3" />
                {formatDate(pack.practice_date)}
              </span>
              {rwSection ? <Badge variant="info"><BookOpen className="h-3 w-3" /> R&amp;W</Badge> : null}
              {mathSection ? <Badge variant="success"><Calculator className="h-3 w-3" /> Math</Badge> : null}
            </div>
          </div>
          <ChevronRight className="h-5 w-5 shrink-0 text-label-foreground" />
        </CardContent>
      </Card>
    </Link>
  );
}

export default function PastpapersPage() {
  const [packs, setPacks] = useState<PastpaperPackPublic[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await examsPublicApi.getPastpaperPacks();
        if (!cancelled) setPacks(data);
      } catch (e: unknown) {
        if (!cancelled) {
          const d = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
          setError(typeof d === "string" ? d : "Could not load past papers.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    if (!q) return packs;
    return packs.filter((p) => {
      const blob = `${p.title || ""} ${p.label || ""} ${p.form_type || ""} ${formatDate(p.practice_date)}`.toLowerCase();
      return blob.includes(q);
    });
  }, [packs, search]);

  const usForms = packs.filter((p) => p.form_type === "US").length;
  const totalSections = packs.reduce((s, p) => s + p.sections.length, 0);

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6 pb-12">
      <div>
        <p className="ds-overline text-primary">Simulation</p>
        <h1 className="ds-h1 mt-1">Past papers</h1>
        <p className="ds-small mt-1">Released SAT papers — work at your own pace and review every question.</p>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <Stat label="Total papers" value={packs.length} icon={FileText} />
        <Stat label="US forms" value={usForms} icon={Globe} />
        <Stat label="Sections" value={totalSections} icon={BookOpen} />
      </div>

      <div className="max-w-md">
        <Input placeholder="Search past papers…" value={search} onChange={(e) => setSearch(e.target.value)} leftIcon={<Search />} />
      </div>

      {error ? <Alert tone="danger" title={error}>Please refresh to try again.</Alert> : null}

      {loading ? (
        <div className="flex flex-col gap-3">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-24 rounded-2xl" />)}</div>
      ) : filtered.length === 0 && !error ? (
        <EmptyState
          icon={FileText}
          title={search ? "No matching papers" : "No past papers yet"}
          description={search ? "Try a different search." : "Past papers appear here once added."}
        />
      ) : (
        <div className="flex flex-col gap-3">
          {filtered.map((pack) => <PackCard key={pack.id} pack={pack} />)}
        </div>
      )}
    </div>
  );
}
