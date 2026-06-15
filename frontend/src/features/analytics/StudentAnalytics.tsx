"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Target, Trophy, Sigma, TrendingUp, Gauge, ArrowRight, Sparkles,
  AlertTriangle, Timer, GraduationCap, CalendarClock, ChevronRight,
} from "lucide-react";
import { cn } from "@/lib/cn";
import {
  Card, CardContent, Badge, Button, ProgressRing, Progress, EmptyState, Skeleton,
  Table, TableHead, TableBody, TableRow, TableHeaderCell, TableCell,
} from "@/components/ui";
import { ChartCard, LineChart, BarChart, RadarChart, type ChartSeries } from "@/components/ui/charts";
import { useAnalyticsData, type AnalyticsModel } from "./useAnalyticsData";

const scoreSeries: ChartSeries[] = [{ key: "score", label: "Score" }];
const accSeries: ChartSeries[] = [{ key: "accuracy", label: "Accuracy" }];

function fmtTime(min: number) {
  if (min < 60) return `${min}m`;
  return `${Math.floor(min / 60)}h ${min % 60}m`;
}
function strandShort(s: string) {
  const parts = s.split("›");
  return (parts[parts.length - 1] || s).trim();
}

export function StudentAnalytics({ previewModel }: { previewModel?: AnalyticsModel }) {
  const { status, analysisReady, model } = useAnalyticsData(previewModel);
  const router = useRouter();
  const ready = previewModel ? true : analysisReady;

  if (status === "booting") return <AnalyticsSkeleton />;
  if (status === "unauthenticated" || !model) {
    return (
      <div className="mx-auto max-w-md py-16">
        <Card><CardContent className="flex flex-col items-center py-10 text-center">
          <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-primary-soft text-primary"><GraduationCap className="h-8 w-8" /></div>
          <h1 className="ds-h2">Analytics</h1>
          <p className="mt-2 text-sm text-muted-foreground">Sign in to see your performance intelligence.</p>
          <Button className="mt-6" fullWidth onClick={() => router.push("/login")}>Sign in</Button>
        </CardContent></Card>
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6 pb-12">
      <div>
        <p className="ds-overline text-primary">Analytics</p>
        <h1 className="ds-h1 mt-1">Your performance intelligence</h1>
        <p className="ds-small mt-1">Where you stand, what&apos;s working, and exactly what to do next.</p>
      </div>

      {/* Performance overview */}
      <Card>
        <CardContent className="grid items-center gap-6 md:grid-cols-[auto_1fr]">
          <div className="flex items-center gap-5">
            <ProgressRing value={model.readiness ?? 0} size={104} strokeWidth={9} color={model.goalReached ? "text-success" : "text-primary"} showLabel={false}>
              <div className="text-center">
                <span className="ds-num block text-2xl font-extrabold leading-none">{model.readiness != null ? `${model.readiness}%` : "—"}</span>
                <span className="ds-overline mt-1 block">Ready</span>
              </div>
            </ProgressRing>
          </div>
          <div className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3 lg:grid-cols-5">
            <Metric icon={Gauge} label="Current" value={model.current ?? "—"} />
            <Metric icon={Trophy} label="Best" value={model.best ?? "—"} />
            <Metric icon={Sigma} label="Average" value={model.average ?? "—"} />
            <Metric icon={TrendingUp} label="Projected" value={model.predicted ?? "—"} />
            <Metric icon={Target} label="Goal" value={model.target ?? "—"} />
          </div>
        </CardContent>
      </Card>

      {/* Action zone: recommendations + goal tracking */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardContent>
            <div className="mb-4 flex items-center gap-2.5">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary text-primary-foreground"><Sparkles className="h-4 w-4" /></span>
              <div><p className="ds-h4 leading-tight">What to do next</p><p className="text-[12px] text-muted-foreground">Derived from your real results</p></div>
            </div>
            {!ready ? <SkeletonRows n={3} /> : model.recommendations.length === 0 ? (
              <p className="text-sm text-muted-foreground">Complete a few sets and tailored recommendations will appear here.</p>
            ) : (
              <div className="flex flex-col gap-2.5">
                {model.recommendations.map((r, i) => (
                  <Link key={r.id} href={r.href} className={cn("ds-ring group flex items-center gap-3 rounded-xl p-4 transition-colors", i === 0 ? "border border-primary/20 bg-primary-soft hover:bg-primary/15" : "bg-surface-2 hover:bg-surface-3")}>
                    <Target className={cn("h-5 w-5 shrink-0", i === 0 ? "text-primary" : "text-muted-foreground")} />
                    <div className="min-w-0 flex-1"><p className={cn("text-sm font-bold", i === 0 ? "text-primary" : "text-foreground")}>{r.title}</p><p className="text-[12px] text-muted-foreground">{r.detail}</p></div>
                    <ArrowRight className="h-4 w-4 shrink-0 text-label-foreground transition-colors group-hover:text-foreground" />
                  </Link>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="flex flex-col gap-4">
            <div className="flex items-center gap-2"><CalendarClock className="h-4 w-4 text-primary" /><p className="ds-h4">Goal tracking</p></div>
            <div>
              <div className="mb-1.5 flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Progress to goal</span>
                <span className="ds-num font-bold">{model.readinessVsTarget ? `${model.readiness ?? 0}%` : "Set a goal"}</span>
              </div>
              <Progress value={model.readinessVsTarget ? model.readiness ?? 0 : 0} tone={model.goalReached ? "success" : "primary"} />
            </div>
            {model.goalReached ? (
              <Badge variant="success" dot>Goal reached</Badge>
            ) : model.gap != null ? (
              <p className="text-sm text-foreground"><span className="ds-num font-bold">{model.gap}</span> points to your goal</p>
            ) : null}
            <div className="rounded-xl bg-surface-2 p-3 text-[13px]">
              <p className="text-muted-foreground">Estimated timeline <span className="text-label-foreground">(projection)</span></p>
              <p className="mt-0.5 font-semibold text-foreground">
                {model.estWeeksToGoal != null ? `~${model.estWeeksToGoal} weeks at +${model.weeklyImprovement}/wk`
                  : model.goalReached ? "You're there — keep it sharp" : "Take 2+ scored sets to project"}
              </p>
            </div>
            <div>
              <div className="mb-1.5 flex items-center justify-between text-sm"><span className="text-muted-foreground">Weekly milestone</span><span className="ds-num font-bold">{model.weeklySessions}/{model.weeklyGoal}</span></div>
              <Progress value={Math.min(100, (model.weeklySessions / model.weeklyGoal) * 100)} tone={model.weeklySessions >= model.weeklyGoal ? "success" : "primary"} size="sm" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Weakness detection */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardContent>
            <div className="mb-3 flex items-center gap-2"><AlertTriangle className="h-4 w-4 text-warning" /><p className="ds-h4">Focus strands</p></div>
            {!ready ? <SkeletonRows n={3} /> : model.weakestStrands.length === 0 ? (
              <EmptyState compact title="No strand data yet" description="Complete tagged assessment sets to surface focus strands." />
            ) : (
              <ul className="flex flex-col gap-2">
                {model.weakestStrands.map((s) => (
                  <li key={s.strand} className="flex items-center justify-between gap-3 rounded-xl border border-border p-3">
                    <span className="min-w-0 truncate text-sm font-semibold text-foreground">{strandShort(s.strand)}</span>
                    <Badge variant={s.accuracy < 60 ? "warning" : "info"}>{s.accuracy}%</Badge>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardContent>
            <div className="mb-3 flex items-center gap-2"><Timer className="h-4 w-4 text-primary" /><p className="ds-h4">Most time-consuming</p></div>
            {!ready ? <SkeletonRows n={4} /> : model.toughestQuestions.length === 0 ? (
              <EmptyState compact title="No timing data" description="Timed sets reveal where pacing slows you down." />
            ) : (
              <ul className="flex flex-col gap-1.5">
                {model.toughestQuestions.slice(0, 5).map((q) => (
                  <li key={q.id} className="flex items-center justify-between gap-3 py-1.5 text-sm">
                    <span className="min-w-0 truncate text-foreground">{q.label}</span>
                    <span className="ds-num shrink-0 font-semibold text-muted-foreground">{Math.round(q.seconds)}s</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
        <ChartCard title="Where am I missing most?" description="Missed questions by section">
          {!ready ? <Skeleton className="h-[200px] rounded-xl" /> : model.missedBySubject.length === 0 ? (
            <EmptyState compact title="No data yet" description="Complete a scored set to see this." />
          ) : (
            <BarChart data={model.missedBySubject} xKey="label" series={[{ key: "missed", label: "Missed" }]} height={200} />
          )}
        </ChartCard>
      </div>

      {/* Skill analysis radar */}
      <ChartCard
        title="Which SAT strands are strongest?"
        description="Accuracy per strand, from your tagged assessment sets"
        actions={<Link href="/assessments" className="ds-ring inline-flex items-center gap-1 rounded-lg text-[13px] font-semibold text-primary">Practice sets <ArrowRight className="h-3.5 w-3.5" /></Link>}
      >
        {!ready ? <Skeleton className="h-[300px] rounded-xl" /> : model.strands.length < 3 ? (
          <EmptyState
            title="Skill radar needs a little more data"
            description="Complete at least 3 assessment sets tagged with SAT strands and your domain radar appears here — no estimates, only real results."
          />
        ) : (
          <RadarChart
            data={model.strands.map((s) => ({ axis: strandShort(s.strand), accuracy: s.accuracy }))}
            axisKey="axis"
            series={accSeries}
            height={320}
          />
        )}
      </ChartCard>

      {/* Subject analysis */}
      <section>
        <div className="mb-4"><h2 className="ds-h3">Subject analysis</h2><p className="ds-small">How accurate and how fast, per section.</p></div>
        <div className="grid gap-4 md:grid-cols-2">
          {model.subjects.map((s) => (
            <Card key={s.key}>
              <CardContent>
                <div className="mb-4 flex items-center justify-between">
                  <p className="ds-h4">{s.label}</p>
                  <Badge variant="neutral">{s.attempts} {s.attempts === 1 ? "set" : "sets"}</Badge>
                </div>
                {!ready ? <SkeletonRows n={2} /> : (
                  <div className="grid grid-cols-3 gap-3">
                    <SubMetric label="Accuracy" value={s.accuracy != null ? `${s.accuracy}%` : "—"} />
                    <SubMetric label="Time" value={s.timeMinutes != null ? fmtTime(s.timeMinutes) : "—"} />
                    <SubMetric label="Improvement" value={s.scoreDelta != null ? `${s.scoreDelta >= 0 ? "+" : ""}${s.scoreDelta}` : "—"} tone={s.scoreDelta != null && s.scoreDelta >= 0 ? "success" : "default"} />
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      {/* Score history */}
      <section>
        <div className="mb-4 flex items-end justify-between">
          <div><h2 className="ds-h3">Score history</h2><p className="ds-small">{model.trendDelta != null ? `${model.trendDelta >= 0 ? "Up" : "Down"} ${Math.abs(model.trendDelta)} points across your tracked sets.` : "Your scored sets over time."}</p></div>
        </div>
        <div className="grid gap-4 lg:grid-cols-5">
          <ChartCard title="Is my score trending up?" className="lg:col-span-3">
            <LineChart data={model.scoreSeries} xKey="label" series={scoreSeries} height={240} yDomain={[400, 1600]} emptyMessage={{ title: "No scored sets yet", description: "Complete a scored set to start your trend." }} />
          </ChartCard>
          <Card className="lg:col-span-2">
            <CardContent className="p-0">
              {model.attemptRows.length === 0 ? (
                <div className="p-5"><EmptyState compact title="No attempts yet" description="Your attempt history will appear here." /></div>
              ) : (
                <Table containerClassName="border-0">
                  <TableHead><TableRow><TableHeaderCell>Set</TableHeaderCell><TableHeaderCell>Score</TableHeaderCell><TableHeaderCell>Date</TableHeaderCell></TableRow></TableHead>
                  <TableBody>
                    {model.attemptRows.slice(0, 6).map((r) => (
                      <TableRow key={r.id}>
                        <TableCell className="max-w-[140px] truncate font-semibold">{r.title}</TableCell>
                        <TableCell className="ds-num">{r.score ?? "—"}</TableCell>
                        <TableCell className="text-muted-foreground">{r.dateLabel}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </div>
      </section>
    </div>
  );
}

function Metric({ icon: Icon, label, value }: { icon: React.ElementType; label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="mb-0.5 flex items-center gap-1.5 text-label-foreground"><Icon className="h-3.5 w-3.5" /><span className="ds-overline">{label}</span></div>
      <p className="ds-num text-2xl font-extrabold tracking-tight text-foreground">{value}</p>
    </div>
  );
}
function SubMetric({ label, value, tone }: { label: string; value: React.ReactNode; tone?: "success" | "default" }) {
  return (
    <div className="rounded-xl bg-surface-2 p-3">
      <p className="ds-overline">{label}</p>
      <p className={cn("ds-num mt-0.5 text-lg font-extrabold", tone === "success" ? "text-success-foreground" : "text-foreground")}>{value}</p>
    </div>
  );
}
function SkeletonRows({ n }: { n: number }) {
  return <div className="flex flex-col gap-2">{Array.from({ length: n }).map((_, i) => <Skeleton key={i} className="h-12 rounded-xl" />)}</div>;
}
function AnalyticsSkeleton() {
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6 pb-12">
      <Skeleton className="h-10 w-72" />
      <Skeleton className="h-32 w-full rounded-2xl" />
      <div className="grid gap-4 lg:grid-cols-3"><Skeleton className="h-64 rounded-2xl lg:col-span-2" /><Skeleton className="h-64 rounded-2xl" /></div>
      <Skeleton className="h-80 w-full rounded-2xl" />
    </div>
  );
}
