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
 *
 * In the console's look (design handoff v0.3): cards, the console's fields, chips and dialog. The
 * words and the calls are the page's own.
 */

import { useEffect, useState } from "react";

import { Icon } from "@/components/ui/Icon";
import { Badge, Button, EmptyState, chipClass, type BadgeTone } from "@/features/console/ui";
import { OpsPageHeader } from "@/features/ops/OpsPageHeader";
import { AREA, FormDialog, FormField, Notice, Panel } from "@/features/ops/settings/settingsParts";
import { CONTROL } from "@/features/questionsAdmin/questionLook";
import type { DiagnosticKind, DiagnosticGroup } from "@/features/mobile/mobileApi";
import {
  useDiagnostic,
  useDiagnostics,
  useReleasePolicy,
  useSaveReleasePolicy,
} from "@/features/mobile/mobileHooks";
import { cn } from "@/lib/cn";

const KIND_LABEL: Record<DiagnosticKind, string> = {
  crash: "Crash",
  hang: "Hang",
  cpu: "CPU limit",
  disk: "Disk writes",
  error: "App error",
};

const KIND_BADGE: Record<DiagnosticKind, BadgeTone> = {
  crash: "critical",
  hang: "attention",
  cpu: "attention",
  disk: "neutral",
  error: "info",
};

const DAYS = [7, 30, 90] as const;

const TH = "h-10 whitespace-nowrap border-b border-ms-border px-3 text-left text-[13px] font-medium text-ms-fg-3 first:pl-5 last:pr-5";
const TD = "border-b border-ms-line px-3 py-2.5 first:pl-5 last:pr-5";

function when(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

/** "Loading…", as the page has always said it, beside the console's spinner. */
function LoadingLine() {
  return (
    <p role="status" className="inline-flex items-center gap-2 text-[14px] font-medium text-ms-fg-2">
      <Icon name="loader" size="sm" className="animate-ms-spin" />
      Loading…
    </p>
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
      icon="ms-appversion"
      aside={
        policy.data?.updated_at ? (
          <span className="text-[13px] text-ms-fg-3">
            Last changed {when(policy.data.updated_at)}
            {policy.data.updated_by ? ` by ${policy.data.updated_by}` : ""}
          </span>
        ) : null
      }
    >
      <div className="p-4 sm:p-5">
        {policy.isError ? (
          <Notice tone="danger">The policy didn&apos;t load. Nothing has changed — reload to try again.</Notice>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField
                label="Latest version in the App Store"
                htmlFor="policy-latest"
                hint="Builds older than this are asked, never forced, to update. Empty: ask nobody."
                error={errors.latest_version}
              >
                <input
                  id="policy-latest"
                  className={cn(CONTROL, "tabular-nums")}
                  placeholder="1.2.0"
                  aria-invalid={errors.latest_version ? true : undefined}
                  value={form.latest_version}
                  onChange={(e) => setForm({ ...form, latest_version: e.target.value })}
                />
              </FormField>
              <FormField
                label="Minimum version"
                htmlFor="policy-minimum"
                hint="Builds older than this see an update screen and nothing else. Empty: allow every build."
                error={errors.minimum_version}
              >
                <input
                  id="policy-minimum"
                  className={cn(CONTROL, "tabular-nums")}
                  placeholder="1.1.0"
                  aria-invalid={errors.minimum_version ? true : undefined}
                  value={form.minimum_version}
                  onChange={(e) => setForm({ ...form, minimum_version: e.target.value })}
                />
              </FormField>
            </div>
            <FormField label="App Store link" htmlFor="policy-url" hint="Where the Update button goes." error={errors.update_url}>
              <input
                id="policy-url"
                className={CONTROL}
                placeholder="https://apps.apple.com/app/id…"
                aria-invalid={errors.update_url ? true : undefined}
                value={form.update_url}
                onChange={(e) => setForm({ ...form, update_url: e.target.value })}
              />
            </FormField>
            <FormField
              label="Message"
              htmlFor="policy-message"
              hint="Optional. One sentence shown with the update prompt — what the new build brings."
              error={errors.message}
            >
              <textarea
                id="policy-message"
                className={AREA}
                rows={2}
                aria-invalid={errors.message ? true : undefined}
                value={form.message}
                onChange={(e) => setForm({ ...form, message: e.target.value })}
              />
            </FormField>
            {raisingMinimum ? (
              <Notice tone="warning">
                Every app older than {form.minimum_version} will stop at an update screen within a
                minute of saving. Make sure that version is already live in the App Store.
              </Notice>
            ) : null}
            {errors.detail ? <Notice tone="danger">{errors.detail}</Notice> : null}
            {saved ? <Notice tone="success">Saved. Phones pick it up within a minute.</Notice> : null}
            <div className="flex justify-end">
              <Button
                variant="primary"
                state={save.isPending ? "busy" : "idle"}
                disabled={policy.isLoading || save.isPending}
                onClick={() => void submit()}
              >
                Save policy
              </Button>
            </div>
          </div>
        )}
      </div>
    </Panel>
  );
}

function DetailModal({ id, onClose }: { id: number; onClose: () => void }) {
  const detail = useDiagnostic(id);
  const d = detail.data;
  return (
    <FormDialog open onClose={onClose} title={d ? KIND_LABEL[d.kind] : "Report"} width={640}>
      {detail.isError ? (
        <Notice tone="danger">This report didn&apos;t load.</Notice>
      ) : !d ? (
        <LoadingLine />
      ) : (
        <div className="flex flex-col gap-3 text-[14px] text-ms-fg">
          <p className="break-words rounded-ms-ctl bg-ms-surface px-3 py-2 font-ms-mono text-[12px] leading-5">{d.signature}</p>
          {d.message ? <p className="text-ms-fg-2">{d.message}</p> : null}
          <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-[13px]">
            <dt className="text-ms-fg-3">App</dt>
            <dd className="tabular-nums">
              {d.app_version || "—"} ({d.build || "—"})
            </dd>
            <dt className="text-ms-fg-3">Device</dt>
            <dd>
              {d.device_model || "—"} · {d.os_version || "—"}
            </dd>
            <dt className="text-ms-fg-3">Happened</dt>
            <dd className="tabular-nums">{when(d.occurred_at)}</dd>
            <dt className="text-ms-fg-3">Received</dt>
            <dd className="tabular-nums">{when(d.received_at)}</dd>
            <dt className="text-ms-fg-3">Signed in</dt>
            <dd>{d.user ?? "Nobody"}</dd>
          </dl>
          {d.payload != null ? (
            <div>
              <p className="text-ms-over mb-1.5 uppercase text-ms-fg-3">
                Payload — symbolicate call stacks against this build&apos;s dSYM
              </p>
              <pre className="max-h-80 overflow-auto rounded-ms-ctl bg-ms-surface-2 p-3 font-ms-mono text-[11px] leading-snug text-ms-fg">
                {JSON.stringify(d.payload, null, 2)}
              </pre>
            </div>
          ) : null}
        </div>
      )}
    </FormDialog>
  );
}

function DiagnosticsPanel() {
  const [days, setDays] = useState<number>(7);
  const [kind, setKind] = useState<DiagnosticKind | "">("");
  const [version, setVersion] = useState("");
  const [openId, setOpenId] = useState<number | null>(null);
  const q = useDiagnostics(days, kind, version);
  const data = q.data;

  return (
    <Panel title="Crash & error reports" icon="alert">
      <div className="flex flex-wrap items-center gap-2 border-b border-ms-line px-5 py-3">
        {DAYS.map((d) => (
          <button key={d} type="button" aria-pressed={days === d} className={chipClass(days === d)} onClick={() => setDays(d)}>
            {d} days
          </button>
        ))}
        <span className="mx-1 h-5 w-px bg-ms-border" aria-hidden />
        <button type="button" aria-pressed={kind === ""} className={chipClass(kind === "")} onClick={() => setKind("")}>
          All kinds
        </button>
        {(Object.keys(KIND_LABEL) as DiagnosticKind[]).map((k) => (
          <button key={k} type="button" aria-pressed={kind === k} className={chipClass(kind === k)} onClick={() => setKind(k)}>
            {KIND_LABEL[k]}
            {data ? ` · ${data.totals[k]}` : ""}
          </button>
        ))}
        {data && data.app_versions.length > 0 ? (
          // Sized on a wrapper: CONTROL carries `w-full`.
          <div className="ml-auto w-44">
            <select className={CONTROL} value={version} onChange={(e) => setVersion(e.target.value)} aria-label="App version">
              <option value="">Every version</option>
              {data.app_versions.map((v) => (
                <option key={v} value={v}>
                  {v || "Unknown"}
                </option>
              ))}
            </select>
          </div>
        ) : null}
      </div>

      {q.isError ? (
        <div className="p-4 sm:p-5">
          <Notice tone="danger">The reports didn&apos;t load. They are still on the server — reload to try again.</Notice>
        </div>
      ) : q.isLoading ? (
        <div className="px-5 py-4">
          <LoadingLine />
        </div>
      ) : !data || data.groups.length === 0 ? (
        <EmptyState
          icon="ok"
          title={`Nothing reported in the last ${days} days`}
          detail="Crashes arrive the next time the app opens after one; errors as they happen."
        />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-separate border-spacing-0 text-[14px] text-ms-fg">
            <thead>
              <tr>
                <th className={TH}>What</th>
                <th className={TH}>Kind</th>
                <th className={cn(TH, "text-right")}>Reports</th>
                <th className={cn(TH, "text-right")}>Phones</th>
                <th className={TH}>First seen</th>
                <th className={TH}>Last seen</th>
              </tr>
            </thead>
            <tbody>
              {data.groups.map((g: DiagnosticGroup) => (
                <tr
                  key={`${g.kind}:${g.signature}`}
                  data-group={g.sample_id}
                  className="ms-transition cursor-pointer hover:bg-ms-surface [&:last-child>td]:border-b-0"
                  onClick={() => setOpenId(g.sample_id)}
                >
                  <td className={cn(TD, "max-w-[28rem] break-words font-ms-mono text-[12px]")}>{g.signature}</td>
                  <td className={TD}>
                    <Badge tone={KIND_BADGE[g.kind]} dot={g.kind === "crash" || g.kind === "hang" || g.kind === "cpu"}>
                      {KIND_LABEL[g.kind]}
                    </Badge>
                  </td>
                  <td className={cn(TD, "text-right font-semibold tabular-nums")}>{g.count}</td>
                  <td className={cn(TD, "text-right tabular-nums")}>{g.installs}</td>
                  <td className={cn(TD, "whitespace-nowrap text-[13px] text-ms-fg-2")}>{when(g.first_seen)}</td>
                  <td className={cn(TD, "whitespace-nowrap text-[13px] text-ms-fg-2")}>{when(g.last_seen)}</td>
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
    <div className="flex flex-col gap-5">
      <OpsPageHeader
        section="Mobile app"
        title="Mobile app"
        description="Which iOS builds may still be used, and what is breaking on students' phones."
        actions={
          <span aria-hidden className="grid size-10 place-items-center rounded-[12px] bg-ms-surface-2 text-ms-fg-3">
            <Icon name="mobile" />
          </span>
        }
      />
      <PolicyPanel />
      <DiagnosticsPanel />
    </div>
  );
}
