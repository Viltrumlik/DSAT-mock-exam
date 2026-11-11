"use client";

import { useState, type ReactNode } from "react";

import { Burst } from "@/features/console/Burst";
import { openShortcuts } from "@/features/console/ShortcutsDialog";
import { toast } from "@/features/console/toast";
import { Button, ConfirmDialog, Menu, Sheet, type ButtonState } from "@/features/console/ui";

function Tile({ title, spec, children }: { title: string; spec: string; children: ReactNode }) {
  return (
    <article className="flex flex-col gap-3 rounded-ms-card bg-ms-card p-4 shadow-ms-1">
      <div className="flex min-h-[72px] flex-wrap items-center gap-3">{children}</div>
      <div className="flex flex-col">
        <b className="text-[15px] text-ms-fg">{title}</b>
        <span className="font-ms-mono text-[12px] text-ms-fg-3">{spec}</span>
      </div>
    </article>
  );
}

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * The overlays and their motion (design handoff v0.3, Overlays + Motion boards), each one live:
 * open it, close it, watch it come and go. Samples only; nothing here reaches the server.
 */
export function OverlaysSection() {
  const [dialog, setDialog] = useState<"ok" | "fail" | "delete" | null>(null);
  const [sheet, setSheet] = useState(false);
  const [progress, setProgress] = useState<ButtonState>("idle");
  const [burst, setBurst] = useState(0);

  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-4">
      <Tile title="Dialog — consequence and count" spec="dialog-in/out + scrim · button shows progress">
        <Button onClick={() => setDialog("ok")}>Send reminder…</Button>
        <Button variant="danger" icon="trash" onClick={() => setDialog("delete")}>
          Delete…
        </Button>
      </Tile>
      <Tile title="Wrong — the dialog shakes and says why" spec="animate-ms-shake · on submit only">
        <Button onClick={() => setDialog("fail")}>Try a failing action</Button>
      </Tile>
      <Tile title="Side sheet" spec="480 px · sheet-in/out-right · Esc closes">
        <Button onClick={() => setSheet(true)}>Record payment…</Button>
      </Tile>
      <Tile title="Menu" spec="dialog-in/out · ↑ ↓ Home End · reasons on disabled items">
        <Menu
          label="Actions for Bekzod Jo'rayev"
          text="Actions"
          variant="secondary"
          align="start"
          items={[
            { label: "Send SMS", icon: "msg", shortcut: "S" },
            { label: "Move to another class", icon: "switch", disabledReason: "lc-up runs this class — move him there" },
            { label: "Open in lc-up", icon: "external" },
            "separator",
            { label: "Delete account…", icon: "trash", danger: true },
          ]}
        />
      </Tile>
      <Tile title="Tooltip" spec="400 ms after hover or focus · names icon buttons + shortcut">
        <Button icon="columns" aria-label="Choose columns" shortcut="C" />
        <Button icon="keyboard" aria-label="Keyboard shortcuts" shortcut="?" onClick={openShortcuts} />
      </Tile>
      <Tile title="Toasts" spec="rise-in / sink-out · one at a time · Undo 8 s, pauses on hover">
        <Button size="sm" onClick={() => toast.show({ icon: "filter", message: "Cleared 2 filters", undo: () => undefined })}>
          With Undo
        </Button>
        <Button
          size="sm"
          onClick={() => toast.show({ tone: "error", message: "Couldn’t save the attendance — your marks are kept here.", action: { label: "Retry", icon: "refresh", run: () => undefined } })}
        >
          Error
        </Button>
        <Button size="sm" onClick={() => toast.show({ icon: "ms-sync", message: "lc-up sync started · about 1 minute", action: { label: "View", run: () => undefined } })}>
          Info
        </Button>
      </Tile>
      <Tile title="Button shows progress" spec="label crossfades · blue → green · the tick draws">
        <Button
          variant="primary"
          icon="snow"
          state={progress}
          busyLabel="Freezing…"
          doneLabel="Frozen"
          onClick={async () => {
            setProgress("busy");
            await wait(1100);
            setProgress("done");
            await wait(1400);
            setProgress("idle");
          }}
        >
          Freeze 2
        </Button>
      </Tile>
      <Tile title="Small celebration" spec="8 dots · once a day per job in the product">
        <span className="relative inline-flex h-7 items-center gap-1.5 rounded-full bg-ms-positive-soft px-3 text-[13px] font-semibold text-ms-positive-fg">
          All registers marked
          {burst ? <Burst key={burst} id={`design-${burst}-${Date.now()}`} /> : null}
        </span>
        <Button size="sm" onClick={() => setBurst((n) => n + 1)}>
          Replay
        </Button>
      </Tile>

      <ConfirmDialog
        open={dialog === "ok" || dialog === "fail"}
        onClose={() => setDialog(null)}
        title="Send the debt reminder to 13 students?"
        icon="msg"
        confirmLabel="Send 13 SMS"
        confirmIcon="send"
        busyLabel="Sending…"
        doneLabel="Sent"
        onConfirm={async () => {
          await wait(900);
          if (dialog === "fail") throw new Error("Eskiz has no balance left. Top it up, then send again — nothing was sent.");
        }}
      >
        <p>Recipients: 13 students · 2 more have no phone and are skipped.</p>
        <p>Cost 13 SMS · 1 950 so’m. SMS cannot be recalled once sent.</p>
      </ConfirmDialog>
      <ConfirmDialog
        open={dialog === "delete"}
        onClose={() => setDialog(null)}
        title="Delete Bekzod Jo'rayev’s account?"
        icon="trash"
        tone="critical"
        confirmLabel="Delete account"
        confirmIcon="trash"
        busyLabel="Deleting…"
        doneLabel="Deleted"
        typeToConfirm="DELETE"
        onConfirm={() => wait(900)}
      >
        <p>
          Removes his sign-in, results and history from MasterSAT. lc-up keeps its own record. <b className="text-ms-fg">This cannot be undone.</b>
        </p>
      </ConfirmDialog>
      <Sheet
        open={sheet}
        onClose={() => setSheet(false)}
        title="Record payment"
        footer={
          <>
            <span className="mr-auto text-[13px] text-ms-fg-3">Esc to close</span>
            <Button variant="ghost" onClick={() => setSheet(false)}>
              Cancel
            </Button>
            <Button variant="primary" onClick={() => setSheet(false)}>
              Record 750 000 so’m
            </Button>
          </>
        }
      >
        <p className="text-[15px] text-ms-fg-2">Bekzod Jo&apos;rayev · Middle M5 · Math. The list behind keeps its place.</p>
      </Sheet>
    </div>
  );
}
