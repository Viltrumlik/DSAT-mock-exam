// A validated, typed message channel over an IslandTransport.
//
// Inbound (native -> island): JSON strings are parsed, then every message is checked against
// protocol/schema.json for direction `to_web` and this island. Anything else is dropped and
// reported back as `error{where:"protocol.in"}` — the island never acts on a malformed
// message.
//
// Outbound (island -> native): every message is checked for direction `to_native` before it
// leaves. Native drops anything that does not match the schema, so sending an invalid
// message would be a silent no-op on the other side; here it becomes a visible error instead.
import {
  PROTOCOL_VERSION,
  validateMessage,
  type ContentToNative,
  type DesmosToNative,
  type IslandKind,
  type NativeToContent,
  type NativeToDesmos,
} from "./protocol";
import type { IslandTransport } from "./transport";

/** A message without its envelope version (the channel adds `v`). */
export type Outgoing<M> = M extends unknown ? Omit<M, "v"> : never;

type InboundFor<K extends IslandKind> = K extends "content" ? NativeToContent : NativeToDesmos;
type OutboundFor<K extends IslandKind> = K extends "content" ? ContentToNative : DesmosToNative;

export interface ChannelStats {
  received: number;
  dropped: number;
  sent: number;
  refused: number;
}

const MAX_WHERE = 200;
const MAX_MESSAGE = 2000;

export class IslandChannel<K extends IslandKind> {
  readonly stats: ChannelStats = { received: 0, dropped: 0, sent: 0, refused: 0 };
  private unlisten: (() => void) | null = null;

  constructor(
    private readonly transport: IslandTransport,
    readonly island: K,
    private readonly onMessage: (message: InboundFor<K>) => void,
  ) {}

  get transportName(): string {
    return this.transport.name;
  }

  start(): void {
    if (this.unlisten) return;
    this.unlisten = this.transport.listen((data) => this.receive(data));
  }

  stop(): void {
    this.unlisten?.();
    this.unlisten = null;
  }

  /** Validate and deliver one inbound value (exposed for hosts that push directly). */
  receive(data: unknown): void {
    let value = data;
    if (typeof value === "string") {
      try {
        value = JSON.parse(value);
      } catch {
        this.drop("not JSON");
        return;
      }
    }
    const reason = validateMessage(value, { direction: "to_web", island: this.island });
    if (reason) {
      this.drop(reason);
      return;
    }
    this.stats.received++;
    try {
      this.onMessage(value as InboundFor<K>);
    } catch (err) {
      this.reportError(`handle ${(value as { t: string }).t}`, err);
    }
  }

  /** Send one message; returns false (and reports) when it fails validation. */
  send(message: Outgoing<OutboundFor<K>>): boolean {
    const full = { v: PROTOCOL_VERSION, ...message } as Record<string, unknown>;
    const reason = validateMessage(full, { direction: "to_native", island: this.island });
    if (reason) {
      this.stats.refused++;
      // Never recurse: an invalid error message is only logged.
      if (full.t !== "error") this.sendError("protocol.out", `${String(full.t)}: ${reason}`);
      console.error(`[island] refused outgoing ${String(full.t)}: ${reason}`);
      return false;
    }
    this.stats.sent++;
    this.transport.send(full);
    return true;
  }

  /** `error{where, message}`, clipped to the schema's limits. */
  sendError(where: string, message: string): void {
    const full = {
      v: PROTOCOL_VERSION,
      t: "error",
      where: where.slice(0, MAX_WHERE),
      message: message.slice(0, MAX_MESSAGE),
    };
    if (validateMessage(full, { direction: "to_native", island: this.island }) === null) {
      this.stats.sent++;
      this.transport.send(full);
    }
  }

  reportError(where: string, err: unknown): void {
    const message = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    console.error(`[island] ${where}:`, err);
    this.sendError(where, message);
  }

  private drop(reason: string): void {
    this.stats.dropped++;
    console.warn(`[island] dropped inbound message: ${reason}`);
    this.sendError("protocol.in", reason);
  }
}
