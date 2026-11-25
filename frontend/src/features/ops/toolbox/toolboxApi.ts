import api from "@/lib/api";

/**
 * `/staging/…` — the test copy's toolbox (backend app `staging`). Every endpoint answers 404 anywhere but the copy, and
 * on it only the owner and admins get in. Paths are root-relative to the axios instance, whose baseURL already ends in
 * the API prefix.
 */
export const BASE = "/staging";

export type Channel = "sms" | "telegram" | "email" | "push";

/** A full copy of the database the time machine can go back to (`stg_timemachine.checkpoint`). */
export interface Checkpoint {
  id: number;
  db: string;
  kind: "base" | "jump";
  label: string;
  offset_days: number;
  /** "YYYY-MM-DD": the copy's date when it was taken. */
  test_date: string;
  taken_at: string;
}

/** What `manage.py staging_after_day` says it did on one test day. */
export interface DayReport {
  test_date: string;
  lessons: { count: number; amount: number };
  frozen: number;
  unfrozen: number;
  messages: Record<Channel, number>;
  alerts: string[];
  errors: string[];
}

/** One request as the time machine ran it (`busy`, `last`, `history`). */
export interface TimeJob {
  id: string | null;
  action: string;
  params?: Record<string, unknown>;
  by?: string | null;
  started_at?: string;
  finished_at?: string;
  ok?: boolean;
  result?: unknown;
  error?: string;
}

export interface TimeState {
  offset_days: number;
  test_date: string;
  checkpoints: Checkpoint[];
  busy: TimeJob | null;
  last: TimeJob | null;
  history: TimeJob[];
  saved_at: string | null;
  /** A request is waiting for the time machine to take it. */
  pending: boolean;
}

export type TimeRequest =
  | { action: "forward"; days: number }
  | { action: "to"; date: string }
  | { action: "back"; checkpoint: number }
  | { action: "today" }
  | { action: "refresh" };

export interface ToolboxStatus {
  release: Record<string, string> | null;
  database: string;
  /** When the copy was taken from prod (the time machine's base checkpoint); null when it does not know. */
  database_copied_at: string | null;
  toolbox: boolean;
  capture: boolean;
  clock: { offset_days: number; test_now: string };
  worker_alive: boolean;
  last_tick: string | null;
  left_lcup: boolean;
  finished: boolean;
}

export interface ToolboxAction {
  id: number;
  at: string;
  by: string;
  action: string;
  detail: Record<string, unknown>;
}

export interface ToolboxGroup {
  id: number;
  name: string;
  monthly_price: number | null;
  lesson_days: string;
}

export interface ToolboxPerson {
  id: number;
  name: string;
  role: string;
  phone: string;
  parent_phone: string;
  frozen: boolean;
  /** The ledger balance in whole so'm; null for someone with no account. */
  balance: number | null;
}

export type SeatStatus = "trial" | "active";

export interface RegisterResult {
  session_id: number;
  date: string;
  opened: boolean;
  students: number;
  present: number;
  absent: number;
}

export interface BeatTask {
  name: string;
  task: string;
  schedule: string;
}

export interface TaskRun {
  name: string;
  task: string;
  ok: boolean;
  result: string;
}

export interface CapturedMessage {
  id: number;
  channel: Channel;
  to: string;
  subject: string;
  body: string;
  meta: Record<string, unknown>;
  created_at: string;
}

export interface MessagesPage {
  count: number;
  page: number;
  pages: number;
  results: CapturedMessage[];
}

export interface MessageQuery {
  channel?: Channel | "";
  q?: string;
  page?: number;
}

export interface SignInLink {
  url: string;
  expires_at: string;
}

export const toolboxApi = {
  async status(): Promise<ToolboxStatus> {
    return (await api.get<ToolboxStatus>(`${BASE}/status/`)).data;
  },
  async time(): Promise<TimeState> {
    return (await api.get<TimeState>(`${BASE}/time/`)).data;
  },
  async ask(body: TimeRequest): Promise<{ id: string }> {
    return (await api.post<{ id: string }>(`${BASE}/time/`, body)).data;
  },
  async actions(): Promise<ToolboxAction[]> {
    return (await api.get<ToolboxAction[]>(`${BASE}/actions/`)).data;
  },
  async groups(): Promise<ToolboxGroup[]> {
    return (await api.get<ToolboxGroup[]>(`${BASE}/groups/`)).data;
  },
  async people(q: string): Promise<ToolboxPerson[]> {
    return (await api.get<ToolboxPerson[]>(`${BASE}/people/`, { params: { q } })).data;
  },
  async makeStudents(body: { classroom_id: number; status: SeatStatus; count: number; first_payment: boolean }): Promise<{ students: ToolboxPerson[] }> {
    return (await api.post<{ students: ToolboxPerson[] }>(`${BASE}/students/`, body)).data;
  },
  async setBalance(body: { user_id: number; target: number }): Promise<{ user_id: number; balance: number }> {
    return (await api.post<{ user_id: number; balance: number }>(`${BASE}/balance/`, body)).data;
  },
  async fillRegister(body: { classroom_id: number; date: string; mode: "present" | "some_absent" | "none" }): Promise<RegisterResult> {
    return (await api.post<RegisterResult>(`${BASE}/register/`, body)).data;
  },
  async tasks(): Promise<BeatTask[]> {
    return (await api.get<BeatTask[]>(`${BASE}/tasks/`)).data;
  },
  async runTask(name: string): Promise<TaskRun> {
    return (await api.post<TaskRun>(`${BASE}/tasks/run/`, { name })).data;
  },
  async messages(query: MessageQuery): Promise<MessagesPage> {
    const params = { channel: query.channel || undefined, q: query.q || undefined, page: query.page && query.page > 1 ? query.page : undefined };
    return (await api.get<MessagesPage>(`${BASE}/messages/`, { params })).data;
  },
  async clearMessages(): Promise<{ deleted: number }> {
    return (await api.post<{ deleted: number }>(`${BASE}/messages/clear/`)).data;
  },
  async signInLink(userId: number): Promise<SignInLink> {
    return (await api.post<SignInLink>(`${BASE}/sign-in-link/`, { user_id: userId })).data;
  },
};
