/**
 * The live quiz socket.
 *
 * A thin, framework-free wrapper over `WebSocket`: it reconnects, it heartbeats, and it
 * hands every frame to one callback. It holds no game state — the server sends a full
 * `session_state` snapshot on every connect, so the client can always render the room from
 * whatever arrived last rather than from a history it accumulated.
 *
 * This is NOT the SSE hint bus in `lib/realtime.ts`. That one is served by gunicorn and is
 * switched off; this one is terminated by a separate ASGI process and does not touch the
 * three sync workers.
 */

export type LiveQuizEvent =
  | "session_state"
  | "participant_joined"
  | "participant_left"
  | "lobby_updated"
  | "game_started"
  | "question_started"
  | "question_time_warning"
  | "question_ended"
  | "answer_result"
  | "answer_tally"
  | "leaderboard_updated"
  | "game_paused"
  | "game_resumed"
  | "game_finished"
  | "session_terminated"
  | "removed_from_session"
  | "error"
  | "pong";

export type LiveQuizFrame = { type: LiveQuizEvent; data: Record<string, unknown> };

export type LiveSocketStatus = "connecting" | "open" | "closed" | "refused";

export interface LiveSocketHandle {
  send: (type: string, payload?: Record<string, unknown>) => void;
  close: () => void;
}

/** Close codes the server uses. 1000–2999 are the protocol's own. */
const CLOSE_DISABLED = 4503;
const CLOSE_UNAUTHENTICATED = 4401;
const CLOSE_FORBIDDEN = 4403;
const CLOSE_GONE = 4404;

/** A close the client must not retry — retrying would just be refused again, forever. */
const FINAL_CLOSES = new Set([CLOSE_DISABLED, CLOSE_UNAUTHENTICATED, CLOSE_FORBIDDEN, CLOSE_GONE]);

const HEARTBEAT_MS = 25_000;
const BACKOFF_START_MS = 1_000;
const BACKOFF_MAX_MS = 15_000;

function socketUrl(sessionId: number): string {
  // Dev has no /ws proxy (next.config.ts rewrites HTTP only), so point straight at daphne
  // with NEXT_PUBLIC_LIVEQUIZ_WS_URL=ws://localhost:8001 when running locally.
  const base = process.env.NEXT_PUBLIC_LIVEQUIZ_WS_URL;
  if (base) return `${base.replace(/\/$/, "")}/ws/livequiz/${sessionId}/`;
  const scheme = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${scheme}//${window.location.host}/ws/livequiz/${sessionId}/`;
}

export function openLiveQuizSocket(
  sessionId: number,
  handlers: {
    onFrame: (frame: LiveQuizFrame) => void;
    onStatus?: (status: LiveSocketStatus, detail?: { code?: number }) => void;
  },
): LiveSocketHandle {
  let socket: WebSocket | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  let retry: ReturnType<typeof setTimeout> | null = null;
  let backoff = BACKOFF_START_MS;
  let disposed = false;

  const clearTimers = () => {
    if (heartbeat) clearInterval(heartbeat);
    if (retry) clearTimeout(retry);
    heartbeat = null;
    retry = null;
  };

  const schedule = () => {
    if (disposed) return;
    retry = setTimeout(connect, backoff);
    backoff = Math.min(BACKOFF_MAX_MS, Math.round(backoff * 1.8));
  };

  function connect() {
    if (disposed) return;
    handlers.onStatus?.("connecting");

    let next: WebSocket;
    try {
      next = new WebSocket(socketUrl(sessionId));
    } catch {
      // A malformed URL or a blocked scheme. Treat it as a closed socket and back off
      // rather than throwing into whatever rendered us.
      schedule();
      return;
    }
    socket = next;

    next.onopen = () => {
      backoff = BACKOFF_START_MS;
      handlers.onStatus?.("open");
      heartbeat = setInterval(() => {
        if (next.readyState === WebSocket.OPEN) {
          next.send(JSON.stringify({ type: "heartbeat" }));
        }
      }, HEARTBEAT_MS);
    };

    next.onmessage = (raw) => {
      let frame: LiveQuizFrame | null = null;
      try {
        frame = JSON.parse(String(raw.data)) as LiveQuizFrame;
      } catch {
        return;
      }
      if (frame && frame.type) handlers.onFrame(frame);
    };

    next.onclose = (event) => {
      clearTimers();
      socket = null;
      if (disposed) return;
      if (FINAL_CLOSES.has(event.code)) {
        // The server has told us why, and it will not change by asking again.
        handlers.onStatus?.("refused", { code: event.code });
        return;
      }
      handlers.onStatus?.("closed", { code: event.code });
      schedule();
    };

    next.onerror = () => {
      // `onclose` always follows, and it carries the code. Nothing useful to do here.
    };
  }

  connect();

  return {
    send(type, payload = {}) {
      if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type, ...payload }));
      }
    },
    close() {
      disposed = true;
      clearTimers();
      if (socket) {
        socket.onclose = null;
        socket.close();
        socket = null;
      }
      handlers.onStatus?.("closed");
    },
  };
}

export function closeReasonText(code?: number): string {
  switch (code) {
    case CLOSE_DISABLED:
      return "Live quizzes are not switched on yet.";
    case CLOSE_UNAUTHENTICATED:
      return "Your session has expired. Sign in again to rejoin.";
    case CLOSE_FORBIDDEN:
      return "You do not have a place in this quiz.";
    case CLOSE_GONE:
      return "That quiz is no longer running.";
    default:
      return "Lost contact with the quiz.";
  }
}
