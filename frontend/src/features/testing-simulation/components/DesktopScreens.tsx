"use client";
import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Download,
  Lock,
  Monitor,
  MonitorSmartphone,
  RefreshCw,
  XCircle,
} from "lucide-react";

import { desktop, type PrecheckReport } from "@/lib/desktop/bridge";
import { DesktopBlockedError, type DesktopBlockReason } from "@/lib/desktop/lockdownSession";
import { DESKTOP_DOWNLOAD_URL, openInAppLink } from "@/lib/desktop/routes";
import { isLowBattery, useBattery } from "@/lib/desktop/useBattery";

import { PrecheckFailedError } from "../hooks/useDesktopLockdown";
import { SatColorRule } from "./SatColorRule";

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-screen flex-col bg-white">
      <SatColorRule />
      <div className="flex flex-1 items-center justify-center overflow-y-auto px-6 py-8">
        <div className="w-full max-w-lg rounded-3xl border border-slate-200 bg-white p-10 shadow-sm">{children}</div>
      </div>
      <SatColorRule />
    </div>
  );
}

function Badge({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-blue-50 text-blue-700">
      {children}
    </div>
  );
}

const primaryButton =
  "inline-flex w-full items-center justify-center gap-2 rounded-full bg-blue-700 px-8 py-3 text-base font-bold text-white transition-colors hover:bg-blue-800 disabled:opacity-50";
const linkButton = "inline-flex items-center gap-1.5 text-sm font-bold text-slate-500 hover:text-slate-800";

// ── Pre-check (in the app) ────────────────────────────────────────────────────

type RowState = "ok" | "fix" | "warn";

function CheckRow({
  state,
  title,
  hint,
  action,
}: {
  state: RowState;
  title: string;
  hint?: string;
  action?: React.ReactNode;
}) {
  const icon =
    state === "ok" ? (
      <CheckCircle2 className="h-5 w-5 text-green-700" aria-hidden />
    ) : state === "warn" ? (
      <AlertTriangle className="h-5 w-5 text-amber-600" aria-hidden />
    ) : (
      <XCircle className="h-5 w-5 text-red-600" aria-hidden />
    );
  return (
    <li className="flex items-start gap-3 py-3">
      <span className="mt-0.5 shrink-0">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-bold text-slate-900">{title}</span>
        {hint ? <span className="mt-0.5 block text-sm text-slate-600">{hint}</span> : null}
      </span>
      {action}
    </li>
  );
}

interface DesktopPrecheckScreenProps {
  /** The paper is already running (the app was reopened mid-midterm). */
  resume: boolean;
  /** Lock the machine and continue. Throws when the machine fails or the server refuses. */
  onContinue: () => Promise<void>;
  onBack?: () => void;
}

/**
 * The last screen before a midterm: what must change on this computer, fixed in place, and
 * the one button that locks it down. The check re-runs every two seconds, so closing
 * Telegram or unplugging a projector turns its row green without a click.
 */
export function DesktopPrecheckScreen({ resume, onContinue, onBack }: DesktopPrecheckScreenProps) {
  const [report, setReport] = useState<PrecheckReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [closing, setClosing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const battery = useBattery();

  const refresh = useCallback(async () => {
    try {
      setReport(await desktop.precheck());
    } catch {
      setError("This computer could not be checked. Close the MasterSAT app and open it again.");
    }
  }, []);

  useEffect(() => {
    void refresh();
    const t = setInterval(() => void refresh(), 2000);
    return () => clearInterval(t);
  }, [refresh]);

  const closeApp = async (exe: string) => {
    setClosing(exe);
    try {
      await desktop.closeApp(exe);
    } catch {
      /* the next check shows whether it closed */
    } finally {
      setClosing(null);
      void refresh();
    }
  };

  const proceed = async () => {
    setBusy(true);
    setError(null);
    try {
      await onContinue();
    } catch (e) {
      if (e instanceof PrecheckFailedError) setReport(e.report);
      else if (e instanceof DesktopBlockedError) setError(e.message);
      else setError("That didn't go through. Check your internet connection and try again.");
      setBusy(false);
    }
  };

  const apps = report?.apps ?? [];
  const lowBattery = isLowBattery(battery);

  return (
    <Frame>
      <Badge>
        <Lock className="h-7 w-7" />
      </Badge>
      <h1 className="mt-4 text-center text-2xl font-bold tracking-tight text-slate-900">
        {resume ? "Resume your midterm" : "Get this computer ready"}
      </h1>
      <p className="mt-2 text-center text-sm font-medium text-slate-500">
        When you continue, MasterSAT locks this computer until your midterm ends. Other apps,
        notifications, screenshots and copying are turned off.
      </p>

      <ul className="mt-6 divide-y divide-slate-100 border-y border-slate-100" aria-live="polite">
        {report === null ? (
          <li className="flex items-center gap-3 py-3 text-sm font-semibold text-slate-500">
            <RefreshCw className="h-4 w-4 animate-spin" aria-hidden /> Checking this computer…
          </li>
        ) : (
          <>
            <CheckRow
              state={report.displays <= 1 ? "ok" : "fix"}
              title={report.displays <= 1 ? "One screen" : `${report.displays} screens connected`}
              hint={report.displays <= 1 ? undefined : "Disconnect the second monitor or projector."}
            />
            {report.remote ? (
              <CheckRow
                state="fix"
                title="Remote Desktop session"
                hint="Take the midterm on this computer itself, not over Remote Desktop."
              />
            ) : null}
            {report.vm ? (
              <CheckRow state="fix" title="Virtual machine" hint="Midterms can't be taken inside a virtual machine." />
            ) : null}
            {apps.length === 0 ? (
              <CheckRow state="ok" title="No chat or screen-sharing apps open" />
            ) : (
              apps.map((app) => (
                <CheckRow
                  key={app.exe}
                  state="fix"
                  title={`Close ${app.name}`}
                  hint={app.closable ? undefined : `Close ${app.name} from the system tray, then come back.`}
                  action={
                    app.closable ? (
                      <button
                        type="button"
                        onClick={() => void closeApp(app.exe)}
                        disabled={closing === app.exe}
                        className="shrink-0 rounded-full border border-slate-300 px-4 py-1.5 text-sm font-bold text-slate-800 hover:bg-slate-50 disabled:opacity-50"
                      >
                        {closing === app.exe ? "Closing…" : "Close"}
                      </button>
                    ) : null
                  }
                />
              ))
            )}
            {battery ? (
              <CheckRow
                state={lowBattery ? "warn" : "ok"}
                title={battery.charging ? `Battery ${battery.percent ?? "—"}%, charging` : `Battery ${battery.percent ?? "—"}%`}
                hint={lowBattery ? "Plug in your charger before you start." : undefined}
              />
            ) : null}
          </>
        )}
      </ul>

      {error ? <p className="mt-4 text-center text-sm font-semibold text-red-600">{error}</p> : null}

      <button
        type="button"
        onClick={() => void proceed()}
        disabled={!report?.ok || busy}
        className={`${primaryButton} mt-7`}
      >
        <Lock className="h-5 w-5" />
        {busy ? "Locking…" : resume ? "Lock and resume" : "Lock and start"}
      </button>
      {onBack ? (
        <div className="mt-4 text-center">
          <button type="button" onClick={onBack} className={linkButton}>
            <ArrowLeft className="h-4 w-4" /> Back
          </button>
        </div>
      ) : null}
    </Frame>
  );
}

// ── In a browser: this midterm belongs to the app ───────────────────────────

export function OpenInAppScreen({ attemptId, reason }: { attemptId: number; reason: DesktopBlockReason | null }) {
  const elsewhere = reason === "desktop_session_replaced";
  return (
    <Frame>
      <Badge>
        <MonitorSmartphone className="h-7 w-7" />
      </Badge>
      <h1 className="mt-4 text-center text-2xl font-bold tracking-tight text-slate-900">
        {elsewhere ? "This midterm is open in the MasterSAT app" : "Take this midterm in the MasterSAT app"}
      </h1>
      <p className="mt-2 text-center text-sm font-medium text-slate-500">
        {elsewhere
          ? "Your answers are saved. Continue in the app on the computer where you started."
          : "Midterms run in the MasterSAT app for Windows, which keeps the test window locked while you work."}
      </p>
      <a href={openInAppLink(`/exam/${attemptId}?src=midterm`)} className={`${primaryButton} mt-7`}>
        <Monitor className="h-5 w-5" /> Open in the MasterSAT app
      </a>
      <a
        href={DESKTOP_DOWNLOAD_URL}
        className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-full border border-slate-300 px-8 py-3 text-base font-bold text-slate-800 hover:bg-slate-50"
      >
        <Download className="h-5 w-5" /> Download for Windows
      </a>
      <p className="mt-5 text-center text-xs font-medium text-slate-500">
        Using a Mac or a Chromebook? Ask your teacher to let you take it in the browser.
      </p>
    </Frame>
  );
}

// ── In the app: something only the student or the app can resolve ───────────

export function SessionMovedScreen({ onHome }: { onHome: () => void }) {
  return (
    <Frame>
      <Badge>
        <MonitorSmartphone className="h-7 w-7" />
      </Badge>
      <h1 className="mt-4 text-center text-2xl font-bold tracking-tight text-slate-900">
        This midterm was opened in another window
      </h1>
      <p className="mt-2 text-center text-sm font-medium text-slate-500">
        Your answers are saved. Continue in the MasterSAT window where it is open now.
      </p>
      <button type="button" onClick={onHome} className={`${primaryButton} mt-7`}>
        Back to my tests
      </button>
    </Frame>
  );
}

export function AppUpdateRequiredScreen({ onHome }: { onHome: () => void }) {
  return (
    <Frame>
      <Badge>
        <RefreshCw className="h-7 w-7" />
      </Badge>
      <h1 className="mt-4 text-center text-2xl font-bold tracking-tight text-slate-900">Update the MasterSAT app</h1>
      <p className="mt-2 text-center text-sm font-medium text-slate-500">
        This version can&apos;t start midterms any more. Close the app and open it again — it updates itself, and
        your work is saved.
      </p>
      <button type="button" onClick={onHome} className={`${primaryButton} mt-7`}>
        Back to my tests
      </button>
    </Frame>
  );
}
