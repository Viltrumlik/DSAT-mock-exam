"use client";

/**
 * /ops/mobile — the iOS app's release policy and its crash reports.
 *
 * Two jobs that belong together: when the reports say a build is broken, the fix ships in a
 * new build, and the policy is how everyone still on the broken one is moved off it.
 *
 * - **Release policy.** The newest build in the store (older builds are ASKED to update) and
 *   the oldest build allowed in (older builds see an update screen and nothing else). Saved
 *   here it applies within a minute — no deploy.
 * - **Crash & error reports.** MetricKit crashes and hangs from phones, and the app's own
 *   non-fatal errors (a response it could not read is the sign it has fallen behind the API),
 *   grouped by signature because the question is "what is breaking, on how many phones".
 *
 * Super admins only: raising the minimum can stop every student's app at once.
 */

import { useEffect, useState } from "react";
import { AlertTriangle, Smartphone } from "lucide-react";
import { Alert, Badge, Button, Field, Input, Modal, Textarea } from "@/components/ui";
import type { BadgeVariant } from "@/components/ui";
import { OpsPageHeader } from "@/features/ops/OpsPageHeader";
import type { DiagnosticKind, DiagnosticGroup } from "@/features/mobile/mobileApi";
import {
  useDiagnostic,
  useDiagnostics,
  useReleasePolicy,
  useSaveReleasePolicy,
} from "@/features/mobile/mobileHooks";

const KIND_LABEL: Record<DiagnosticKind, string> = {
  crash: "Crash",
  hang: "Hang",
  cpu: "CPU limit",
  disk: "Disk writes",
  error: "App error",
};

const KIND_BADGE: Record<DiagnosticKind, BadgeVariant> = {
  crash: "danger",
  hang: "warning",
  cpu: "warning",
  disk: "neutral",
  error: "info",
};

const DAYS = [7, 30, 90] as const;

function when(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

function Panel({ title, children, aside }: { title: string; children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-card">
      <div className="flex items-center justify-between gap-2 border-b border-border bg-surface-2 px-5 py-2.5">
        <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{title}</p>
        {aside}
      </div>
      <div className="p-5">{children}</div>
    </div>
  );
}

function PolicyPanel() {
  const policy = useReleasePolicy();
  const save = useSaveReleasePolicy();
  const [form, setForm] = useState({ latest_version: "", minimum_version: "", update_url: "", message: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (policy.data) {
      setForm({
        latest_version: policy.data.latest_version,
        minimum_version: policy.data.minimum_version,
        update_url: policy.data.update_url,
        message: policy.data.message,
      });
    }
  }, [policy.data]);

  const raisingMinimum =
    !!form.minimum_version && form.minimum_version !== (policy.data?.minimum_version ?? "");

  const submit = async () => {
    setErrors({});
    setSaved(false);
    try {
      await save.mutateAsync(form);
      setSaved(true);
    } catch (e: unknown) {
      const data = (e as { response?: { data?: unknown } })?.response?.data;
      if (data && typeof data === "object") {
        const out: Record<string, string> = {};
        for (const [k, v] of Object.entries(data as Record<string, unknown>)) {
          out[k] = Array.isArray(v) ? String(v[0] ?? "") : String(v ?? "");
        }
        setErrors(out);
      } else {
        setErrors({ detail: "That didn't save. Try again." });
      }
    }
  };

  return (
    <Panel
      title="Release policy"
      aside={
        policy.data?.updated_at ? (
          <span className="text-xs text-muted-foreground">
            Last changed {when(policy.data.updated_at)}
            {policy.data.updated_by ? ` by ${policy.data.updated_by}` : ""}
          </span>
        ) : null
      }
    >
      {policy.isError ? (
        <Alert tone="danger">The policy didn&apos;t load. Nothing has changed — reload to try again.</Alert>
      ) : (
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Latest version in the App Store"
              hint="Builds older than this are asked, never forced, to update. Empty: ask nobody."
              error={errors.latest_version}
            >
              <Input
                placeholder="1.2.0"
                value={form.latest_version}
                onChange={(e) => setForm({ ...form, latest_version: e.target.value })}
              />
            </Field>
            <Field
              label="Minimum version"
              hint="Builds older than this see an update screen and nothing else. Empty: allow every build."
              error={errors.minimum_version}
            >
              <Input
                placeholder="1.1.0"
                value={form.minimum_version}
                onChange={(e) => setForm({ ...form, minimum_version: e.target.value })}
              />
            </Field>
          </div>
          <Field label="App Store link" hint="Where the Update button goes." error={errors.update_url}>
            <Input
              placeholder="https://apps.apple.com/app/id…"
              value={form.update_url}
              onChange={(e) => setForm({ ...form, update_url: e.target.value })}
            />
          </Field>
          <Field
            label="Message"
            hint="Optional. One sentence shown with the update prompt — what the new build brings."
            error={errors.message}
          >
            <Textarea
              rows={2}
              value={form.message}
              onChange={(e) => setForm({ ...form, message: e.target.value })}
            />
          </Field>
          {raisingMinimum ? (
            <Alert tone="warning">
              <span className="inline-flex items-start gap-2">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                Every app older than {form.minimum_version} will stop at an update screen within a
                minute of saving. Make sure that version is already live in the App Store.
              </span>
            </Alert>
          ) : null}
          {errors.detail ? <Alert tone="danger">{errors.detail}</Alert> : null}
          {saved ? <Alert tone="success">Saved. Phones pick it up within a minute.</Alert> : null}
          <div className="flex justify-end">
            <Button onClick={submit} loading={save.isPending} disabled={policy.isLoading}>
              Save policy
            </Button>
          </div>
        </div>
      )}
    </Panel>
  );
}

function DetailModal({ id, onClose }: { id: number; onClose: () => void }) {
  const detail = useDiagnostic(id);
  const d = detail.data;
  return (
    <Modal open onClose={onClose} title={d ? KIND_LABEL[d.kind] : "Report"}>
      {detail.isError ? (
        <Alert tone="danger">This report didn&apos;t load.</Alert>
      ) : !d ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <div className="space-y-3 text-sm">
          <p className="break-words font-mono text-xs">{d.signature}</p>
          {d.message ? <p>{d.message}</p> : null}
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
            <dt className="text-muted-foreground">App</dt>
            <dd>
              {d.app_version || "—"} ({d.build || "—"})
            </dd>
            <dt className="text-muted-foreground">Device</dt>
            <dd>
              {d.device_model || "—"} · {d.os_version || "—"}
            </dd>
            <dt className="text-muted-foreground">Happened</dt>
            <dd>{when(d.occurred_at)}</dd>
            <dt className="text-muted-foreground">Received</dt>
            <dd>{when(d.received_at)}</dd>
            <dt className="text-muted-foreground">Signed in</dt>
            <dd>{d.user ?? "Nobody"}</dd>
          </dl>
          {d.payload != null ? (
            <div>
              <p className="mb-1 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                Payload — symbolicate call stacks against this build&apos;s dSYM
              </p>
              <pre className="max-h-80 overflow-auto rounded-lg bg-surface-2 p-3 text-[11px] leading-snug">
                {JSON.stringify(d.payload, null, 2)}
              </pre>
            </div>
          ) : null}
        </div>
      )}
    </Modal>
  );
}

function DiagnosticsPanel() {
  const [days, setDays] = useState<number>(7);
  const [kind, setKind] = useState<DiagnosticKind | "">("");
  const [version, setVersion] = useState("");
  const [openId, setOpenId] = useState<number | null>(null);
  const q = useDiagnostics(days, kind, version);
  const data = q.data;

  const chip = (active: boolean) =>
    `rounded-full border px-3 py-1 text-xs font-semibold transition-colors ${
      active ? "border-primary bg-primary text-white" : "border-border bg-card text-muted-foreground hover:text-foreground"
    }`;

  return (
    <Panel title="Crash & error reports">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {DAYS.map((d) => (
          <button key={d} type="button" className={chip(days === d)} onClick={() => setDays(d)}>
            {d} days
          </button>
        ))}
        <span className="mx-1 h-4 w-px bg-border" aria-hidden />
        <button type="button" className={chip(kind === "")} onClick={() => setKind("")}>
          All kinds
        </button>
        {(Object.keys(KIND_LABEL) as DiagnosticKind[]).map((k) => (
          <button key={k} type="button" className={chip(kind === k)} onClick={() => setKind(k)}>
            {KIND_LABEL[k]}
            {data ? ` · ${data.totals[k]}` : ""}
          </button>
        ))}
        {data && data.app_versions.length > 0 ? (
          <select
            className="ml-auto rounded-lg border border-border bg-card px-2 py-1 text-xs"
            value={version}
            onChange={(e) => setVersion(e.target.value)}
            aria-label="App version"
          >
            <option value="">Every version</option>
            {data.app_versions.map((v) => (
              <option key={v} value={v}>
                {v || "Unknown"}
              </option>
            ))}
          </select>
        ) : null}
      </div>

      {q.isError ? (
        <Alert tone="danger">The reports didn&apos;t load. They are still on the server — reload to try again.</Alert>
      ) : q.isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : !data || data.groups.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border px-4 py-8 text-center">
          <p className="text-sm font-semibold">Nothing reported in the last {days} days</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Crashes arrive the next time the app opens after one; errors as they happen.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                <th className="py-2 pr-3">What</th>
                <th className="py-2 pr-3">Kind</th>
                <th className="py-2 pr-3 text-right">Reports</th>
                <th className="py-2 pr-3 text-right">Phones</th>
                <th className="py-2 pr-3">First seen</th>
                <th className="py-2">Last seen</th>
              </tr>
            </thead>
            <tbody>
              {data.groups.map((g: DiagnosticGroup) => (
                <tr
                  key={`${g.kind}:${g.signature}`}
                  className="cursor-pointer border-b border-border/60 hover:bg-surface-2"
                  onClick={() => setOpenId(g.sample_id)}
                >
                  <td className="max-w-[28rem] py-2 pr-3 font-mono text-xs">{g.signature}</td>
                  <td className="py-2 pr-3">
                    <Badge variant={KIND_BADGE[g.kind]}>{KIND_LABEL[g.kind]}</Badge>
                  </td>
                  <td className="py-2 pr-3 text-right tabular-nums">{g.count}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{g.installs}</td>
                  <td className="py-2 pr-3 text-xs text-muted-foreground">{when(g.first_seen)}</td>
                  <td className="py-2 text-xs text-muted-foreground">{when(g.last_seen)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {openId != null ? <DetailModal id={openId} onClose={() => setOpenId(null)} /> : null}
    </Panel>
  );
}

export default function OpsMobilePage() {
  return (
    <div className="space-y-5">
      <OpsPageHeader
        section="Mobile app"
        title="Mobile app"
        description="Which iOS builds may still be used, and what is breaking on students' phones."
        actions={<Smartphone className="h-5 w-5 text-muted-foreground" aria-hidden />}
      />
      <PolicyPanel />
      <DiagnosticsPanel />
    </div>
  );
}
