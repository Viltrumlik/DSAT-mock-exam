"use client";

/**
 * /ui-catalog — design-system review surface (Phase 4 foundation).
 * Renders the full component library, chart abstraction, and navigation
 * shell on real tokens in both themes. Not part of the student IA; this is
 * an internal catalog for review before page rebuilds begin.
 */

import { useState } from "react";
import { usePathname } from "next/navigation";
import {
  Sparkles,
  Target,
  Flame,
  Trophy,
  Search,
  Mail,
  Plus,
  Rocket,
  BookOpen,
} from "lucide-react";
import { AppShell } from "@/components/shell/AppShell";
import { studentNav } from "@/components/shell/navConfig";
import {
  Button,
  Input,
  Textarea,
  Select,
  Checkbox,
  Switch,
  Field,
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
  Badge,
  Alert,
  Avatar,
  Progress,
  ProgressRing,
  Skeleton,
  SkeletonText,
  EmptyState,
  Stat,
  Tabs,
  SegmentedControl,
  Accordion,
  Pagination,
  Modal,
  Drawer,
  ToastProvider,
  useToast,
  Separator,
  Table,
  TableHead,
  TableBody,
  TableRow,
  TableHeaderCell,
  TableCell,
} from "@/components/ui";
import {
  ChartCard,
  LineChart,
  AreaChart,
  BarChart,
  StackedBarChart,
  DonutChart,
  RadarChart,
  type ChartSeries,
} from "@/components/ui/charts";

function Section({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-4">
      <div>
        <h2 className="ds-h2">{title}</h2>
        {subtitle ? <p className="ds-small mt-0.5">{subtitle}</p> : null}
      </div>
      {children}
    </section>
  );
}

const COLOR_TOKENS = [
  { name: "primary", cls: "bg-primary" },
  { name: "accent", cls: "bg-accent" },
  { name: "success", cls: "bg-success" },
  { name: "warning", cls: "bg-warning" },
  { name: "danger", cls: "bg-danger" },
  { name: "info", cls: "bg-info" },
];

const scoreData = [
  { label: "Mar", total: 1280, rw: 650, math: 630 },
  { label: "Apr", total: 1320, rw: 660, math: 660 },
  { label: "May", total: 1360, rw: 680, math: 680 },
  { label: "Jun", total: 1410, rw: 700, math: 710 },
  { label: "Jul", total: 1440, rw: 710, math: 730 },
  { label: "Aug", total: 1480, rw: 730, math: 750 },
];
const scoreSeries: ChartSeries[] = [
  { key: "total", label: "Total" },
  { key: "rw", label: "Reading & Writing" },
  { key: "math", label: "Math" },
];

const activityData = [
  { label: "W1", sessions: 3 },
  { label: "W2", sessions: 5 },
  { label: "W3", sessions: 2 },
  { label: "W4", sessions: 6 },
  { label: "W5", sessions: 4 },
  { label: "W6", sessions: 7 },
];
const sectionData = [
  { label: "Test 1", rw: 22, math: 18 },
  { label: "Test 2", rw: 25, math: 21 },
  { label: "Test 3", rw: 27, math: 24 },
  { label: "Test 4", rw: 28, math: 26 },
];
const sectionSeries: ChartSeries[] = [
  { key: "rw", label: "Reading & Writing" },
  { key: "math", label: "Math" },
];
const donutData = [
  { name: "Correct", value: 42, color: "var(--chart-3)" },
  { name: "Needs review", value: 10, color: "var(--chart-4)" },
  { name: "Skipped", value: 6, color: "var(--chart-2)" },
];
const radarData = [
  { axis: "Algebra", you: 82, target: 92 },
  { axis: "Advanced", you: 68, target: 88 },
  { axis: "Data analysis", you: 74, target: 85 },
  { axis: "Geometry", you: 79, target: 90 },
  { axis: "Craft", you: 88, target: 92 },
  { axis: "Ideas", you: 71, target: 86 },
];
const radarSeries: ChartSeries[] = [
  { key: "you", label: "You" },
  { key: "target", label: "Target" },
];

function ToastDemo() {
  const toast = useToast();
  return (
    <div className="flex flex-wrap gap-2">
      <Button variant="secondary" onClick={() => toast({ title: "Saved", description: "Your answer was autosaved.", tone: "success" })}>
        Success toast
      </Button>
      <Button variant="secondary" onClick={() => toast({ title: "Heads up", description: "Module 2 unlocks after the break.", tone: "info" })}>
        Info toast
      </Button>
      <Button variant="secondary" onClick={() => toast({ title: "Needs attention", description: "One question is still unanswered.", tone: "warning" })}>
        Warning toast
      </Button>
    </div>
  );
}

function Catalog() {
  const [tab, setTab] = useState("overview");
  const [seg, setSeg] = useState<"both" | "rw" | "math">("both");
  const [checked, setChecked] = useState(true);
  const [page, setPage] = useState(3);
  const [modalOpen, setModalOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-12 pb-16">
      <header>
        <p className="ds-overline text-primary">Design system · Phase 4 foundation</p>
        <h1 className="ds-display mt-2">Component catalog</h1>
        <p className="ds-lead mt-2 max-w-2xl">
          The MasterSAT design language — tokens, typography, components and charts — on real
          surfaces. Toggle the theme in the top bar to preview light and dark.
        </p>
      </header>

      <Section title="Color tokens" subtitle="Semantic scales restored: every tone has soft + foreground pairings.">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-6">
          {COLOR_TOKENS.map((t) => (
            <div key={t.name} className="flex flex-col gap-1.5">
              <div className={`h-14 rounded-xl ${t.cls}`} />
              <span className="ds-small">{t.name}</span>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Typography">
        <Card>
          <CardContent className="flex flex-col gap-2">
            <p className="ds-display">1480</p>
            <p className="ds-h1">Page title — h1</p>
            <p className="ds-h2">Section heading — h2</p>
            <p className="ds-h3">Card heading — h3</p>
            <p className="ds-h4">Sub-card — h4</p>
            <p className="text-[15px] text-foreground">Body — the quiet, readable default for everything.</p>
            <p className="ds-small">Small — secondary metadata.</p>
            <p className="ds-overline">Caption label</p>
          </CardContent>
        </Card>
      </Section>

      <Section title="Buttons">
        <Card>
          <CardContent className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center gap-2">
              <Button leftIcon={<Rocket />}>Primary</Button>
              <Button variant="secondary">Secondary</Button>
              <Button variant="outline">Outline</Button>
              <Button variant="subtle">Subtle</Button>
              <Button variant="ghost">Ghost</Button>
              <Button variant="danger">Danger</Button>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm">Small</Button>
              <Button size="md">Medium</Button>
              <Button size="lg">Large</Button>
              <Button loading>Loading</Button>
              <Button disabled>Disabled</Button>
            </div>
          </CardContent>
        </Card>
      </Section>

      <Section title="Form controls">
        <Card>
          <CardContent className="grid gap-5 md:grid-cols-2">
            <Field label="Full name" htmlFor="f-name" hint="As it appears on your score report.">
              <Input id="f-name" placeholder="Ada Lovelace" leftIcon={<Search />} />
            </Field>
            <Field label="Email" htmlFor="f-email" error="Enter a valid email address.">
              <Input id="f-email" placeholder="you@example.com" leftIcon={<Mail />} invalid />
            </Field>
            <Field label="Target section" htmlFor="f-sec">
              <Select id="f-sec" defaultValue="both">
                <option value="both">Reading, Writing & Math</option>
                <option value="rw">Reading & Writing</option>
                <option value="math">Math</option>
              </Select>
            </Field>
            <Field label="Goal note" htmlFor="f-note">
              <Textarea id="f-note" placeholder="What are you aiming for?" />
            </Field>
            <div className="flex items-center gap-6">
              <Checkbox label="Email reminders" defaultChecked />
              <Switch checked={checked} onCheckedChange={setChecked} label="Daily streak nudges" />
            </div>
          </CardContent>
        </Card>
      </Section>

      <Section title="Badges & status" subtitle="Growth-oriented language only — never punishing.">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="success" dot>On track</Badge>
          <Badge variant="info">Building momentum</Badge>
          <Badge variant="warning">Needs attention</Badge>
          <Badge variant="primary">Focus area</Badge>
          <Badge variant="accent">Practice recommended</Badge>
          <Badge variant="neutral">In progress</Badge>
          <Badge variant="live" dot>Live session</Badge>
        </div>
      </Section>

      <Section title="Stats & progress">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="Predicted score" value="1480" icon={Target} delta={40} hint="Up from last attempt" />
          <Stat label="Day streak" value="12" icon={Flame} delta={3} />
          <Stat label="Accuracy" value="86%" icon={Sparkles} delta={-2} hint="A small dip — a quick review will help" />
          <Stat label="Milestones" value="7" icon={Trophy} />
        </div>
        <Card>
          <CardContent className="flex flex-wrap items-center gap-8">
            <div className="flex-1 min-w-[200px] space-y-3">
              <Progress value={72} tone="primary" />
              <Progress value={54} tone="success" />
              <Progress value={33} tone="warning" size="sm" />
            </div>
            <ProgressRing value={72} size={88} showLabel={false}>
              <span className="ds-num text-lg font-extrabold">72%</span>
            </ProgressRing>
          </CardContent>
        </Card>
      </Section>

      <Section title="Cards">
        <div className="grid gap-4 md:grid-cols-3">
          <Card>
            <CardHeader>
              <div>
                <CardTitle>Default</CardTitle>
                <CardDescription>Bordered surface with soft shadow.</CardDescription>
              </div>
              <Badge variant="primary">New</Badge>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">Card body content.</CardContent>
            <CardFooter>
              <Button size="sm" variant="secondary">Action</Button>
            </CardFooter>
          </Card>
          <Card variant="soft">
            <CardContent>
              <CardTitle>Soft</CardTitle>
              <p className="mt-1 text-sm text-muted-foreground">Filled, borderless surface.</p>
            </CardContent>
          </Card>
          <Card variant="interactive">
            <CardContent>
              <CardTitle>Interactive</CardTitle>
              <p className="mt-1 text-sm text-muted-foreground">Hover for elevation.</p>
            </CardContent>
          </Card>
        </div>
      </Section>

      <Section title="Feedback">
        <div className="grid gap-3 md:grid-cols-2">
          <Alert tone="success" title="Goal reached">You hit your target for Algebra. Nice work.</Alert>
          <Alert tone="info" title="Heads up">Your next mock unlocks tomorrow.</Alert>
          <Alert tone="warning" title="Needs attention">2 assignments are due soon.</Alert>
          <Alert tone="danger" title="Action needed">Re-connect your account to keep syncing.</Alert>
        </div>
        <Card>
          <CardContent className="flex flex-col gap-5">
            <div className="flex items-center gap-4">
              <Skeleton variant="circle" className="h-12 w-12" />
              <div className="flex-1"><SkeletonText lines={2} /></div>
            </div>
            <ToastDemo />
          </CardContent>
        </Card>
        <EmptyState
          icon={BookOpen}
          title="No practice yet"
          description="Start your first set and your progress will appear here."
          action={<Button leftIcon={<Plus />}>Start practising</Button>}
        />
      </Section>

      <Section title="Overlays">
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => setModalOpen(true)}>Open modal</Button>
          <Button variant="secondary" onClick={() => setDrawerOpen(true)}>Open drawer</Button>
        </div>
        <Modal
          open={modalOpen}
          onClose={() => setModalOpen(false)}
          title="Set your goal score"
          description="We'll tailor recommendations to it."
          footer={
            <>
              <Button variant="ghost" onClick={() => setModalOpen(false)}>Cancel</Button>
              <Button onClick={() => setModalOpen(false)}>Save goal</Button>
            </>
          }
        >
          <Field label="Target total" htmlFor="goal">
            <Input id="goal" type="number" defaultValue={1500} />
          </Field>
        </Modal>
        <Drawer open={drawerOpen} onClose={() => setDrawerOpen(false)} title="Filters">
          <div className="flex flex-col gap-4">
            <Checkbox label="Reading & Writing" defaultChecked />
            <Checkbox label="Math" defaultChecked />
            <Checkbox label="Completed only" />
          </div>
        </Drawer>
      </Section>

      <Section title="Navigation & data">
        <Tabs
          tabs={[
            { value: "overview", label: "Overview" },
            { value: "sections", label: "Sections" },
            { value: "history", label: "History" },
          ]}
          value={tab}
          onValueChange={setTab}
        />
        <div className="flex flex-wrap items-center gap-3">
          <SegmentedControl
            options={[
              { value: "both", label: "Both" },
              { value: "rw", label: "Reading" },
              { value: "math", label: "Math" },
            ]}
            value={seg}
            onChange={setSeg}
          />
        </div>
        <Table>
          <TableHead>
            <TableRow>
              <TableHeaderCell>Student</TableHeaderCell>
              <TableHeaderCell>Latest</TableHeaderCell>
              <TableHeaderCell>Trend</TableHeaderCell>
              <TableHeaderCell>Status</TableHeaderCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {[
              { n: "Maya R.", s: 1480, d: "+40", st: "On track" as const },
              { n: "Liang W.", s: 1390, d: "+20", st: "Building momentum" as const },
              { n: "Sara K.", s: 1280, d: "+10", st: "Needs attention" as const },
            ].map((r) => (
              <TableRow key={r.n} interactive>
                <TableCell className="flex items-center gap-2.5 font-semibold">
                  <Avatar name={r.n} size={28} /> {r.n}
                </TableCell>
                <TableCell className="ds-num">{r.s}</TableCell>
                <TableCell className="text-success-foreground">{r.d}</TableCell>
                <TableCell>
                  <Badge variant={r.st === "Needs attention" ? "warning" : "success"}>{r.st}</Badge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <div className="flex justify-end">
          <Pagination page={page} pageCount={12} onPageChange={setPage} />
        </div>
        <Accordion
          items={[
            { value: "a", title: "How is my predicted score calculated?", content: "From your most recent full-length attempts, blended toward recency." },
            { value: "b", title: "What counts toward my streak?", content: "Any completed practice set or vocabulary review on a given day." },
          ]}
          defaultOpen={["a"]}
        />
      </Section>

      <Section title="Charts" subtitle="Recharts behind ChartCard wrappers — token colors, light/dark, skeleton & empty states.">
        <div className="grid gap-4 lg:grid-cols-2">
          <ChartCard title="Score progression" description="Last 6 attempts" legend={scoreSeries}>
            <LineChart data={scoreData} xKey="label" series={scoreSeries} yDomain={[400, 1600]} />
          </ChartCard>
          <ChartCard title="Learning progress" description="Cumulative accuracy">
            <AreaChart data={scoreData} xKey="label" series={[{ key: "total", label: "Total" }]} />
          </ChartCard>
          <ChartCard title="Weekly activity">
            <BarChart data={activityData} xKey="label" series={[{ key: "sessions", label: "Sessions" }]} />
          </ChartCard>
          <ChartCard title="Section performance" description="Correct per test" legend={sectionSeries}>
            <StackedBarChart data={sectionData} xKey="label" series={sectionSeries} />
          </ChartCard>
          <ChartCard title="Question distribution">
            <DonutChart data={donutData} centerValue="72%" centerLabel="Accuracy" />
          </ChartCard>
          <ChartCard title="Skill analysis" description="You vs. target" legend={radarSeries}>
            <RadarChart data={radarData} axisKey="axis" series={radarSeries} />
          </ChartCard>
        </div>
      </Section>

      <Separator label="End of catalog" />
    </div>
  );
}

export default function UiCatalogPage() {
  const pathname = usePathname();
  return (
    <AppShell
      brand={{ name: "MasterSAT", tagline: "Learning OS" }}
      nav={studentNav}
      pathname={pathname}
      user={{ name: "Ada Lovelace" }}
      onSignOut={() => {}}
    >
      <ToastProvider>
        <Catalog />
      </ToastProvider>
    </AppShell>
  );
}
