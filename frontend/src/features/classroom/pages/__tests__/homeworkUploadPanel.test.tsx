/**
 * Turning in several files at once, from a student's own homework page.
 *
 * The picker only reaches into one folder at a time, so "four images and six PDFs" is two trips
 * through Choose files. The panel replaced its list on every pick, so the second trip threw the
 * first four away without saying a word — the student pressed Submit believing ten files were
 * going, and their teacher received six.
 *
 * These cover the queue (a pick adds, a repeat does not duplicate, one file can be taken back),
 * the limits the server applies — which are now answered here, before a student waits out an
 * upload that was never going to land, and read from the server rather than copied — and the
 * parts of the submit that already worked and must keep working: the revision guard and one
 * idempotency token per file.
 *
 * Only the HTTP layer is stubbed; the panel goes through its real hooks.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const get = vi.fn();
const submitAssignment = vi.fn();
const getMySubmission = vi.fn();

vi.mock("@/lib/api", () => ({
  default: { get: (...args: unknown[]) => get(...args), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
  classesApi: {
    get: async (id: number) => ({ id, name: "Middle G13", my_role: "STUDENT" }),
    getMySubmission: (...args: unknown[]) => getMySubmission(...args),
    submitAssignment: (...args: unknown[]) => submitAssignment(...args),
  },
  // Aliased at import time by `features/examsStudent/api`.
  examsPublicApi: {},
}));
vi.mock("next/navigation", () => ({
  usePathname: () => "/classes/34/assignments/102",
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>,
}));

const { AssignmentDetailPage } = await import("../AssignmentDetail");

const MB = 1024 * 1024;

/**
 * What the deployment serves on the assignment: the Django defaults, except the batch figure,
 * which is the smaller ceiling Nginx puts on an `/api/` body. The panel must use these and not
 * a set of numbers of its own.
 */
const SERVED_LIMITS = {
  max_files_per_submission: 50,
  max_file_bytes: 50 * MB,
  max_batch_bytes: 60 * MB,
  allowed_extensions: [
    ".doc", ".docx", ".gif", ".jpeg", ".jpg", ".pdf", ".png",
    ".ppt", ".pptx", ".txt", ".webp", ".xls", ".xlsx",
  ],
};

/** `GET /api/classes/34/assignments/102/` for a written homework that takes files. */
const HOMEWORK = {
  id: 102,
  title: "Unit 3 review",
  instructions: "Answer the questions at the end of chapter 3.",
  status: "PUBLISHED",
  category: "HOMEWORK",
  due_at: "2026-09-28T18:00:00+05:00",
  max_score: "100.00",
  allow_file_upload: true,
  assessment_homework: null,
  assessment_homeworks: [],
  vocab_homeworks: [],
  external_urls: [],
  submission_limits: SERVED_LIMITS,
};

/** What this student has turned in so far: one file, and a revision the next submit must match. */
const MY_SUBMISSION = {
  id: 5,
  revision: 3,
  workflow_status: "SUBMITTED",
  files: [{ id: 1, url: "/media/sub/1", file_name: "first-draft.pdf" }],
};

/** Answer the assignment fetch with this homework, optionally with different limits. */
function serveHomework(limits: Record<string, unknown> | null = SERVED_LIMITS) {
  get.mockImplementation(async (url: string) => {
    if (url === "/classes/34/assignments/102/") return { data: { ...HOMEWORK, submission_limits: limits } };
    throw new Error(`unexpected GET ${url}`);
  });
}

/**
 * A file of an arbitrary size without allocating it: only `size` is read, and a real 60 MB
 * string in a jsdom test buys nothing but seconds.
 */
function fakeFile(name: string, bytes: number, lastModified = 1_700_000_000_000): File {
  const f = new File(["x"], name, { lastModified });
  Object.defineProperty(f, "size", { value: bytes });
  return f;
}

/** The array-like a file picker hands to `change`. */
function asFileList(files: File[]): FileList {
  const list: Record<number | string, unknown> = { length: files.length, item: (i: number) => files[i] ?? null };
  files.forEach((f, i) => { list[i] = f; });
  return list as unknown as FileList;
}

let host: HTMLElement;
let root: Root;

const text = () => (host.textContent ?? "").replace(/\s+/g, " ").trim();

function buttonWith(label: string): HTMLButtonElement {
  const b = ([...host.querySelectorAll("button")] as HTMLButtonElement[]).find(
    (el) => (el.textContent ?? "").trim() === label,
  );
  if (!b) throw new Error(`no "${label}" button`);
  return b;
}

/** The panel's hidden `<input type="file" multiple>`. */
function picker(): HTMLInputElement {
  const input = host.querySelector('input[type="file"]') as HTMLInputElement | null;
  if (!input) throw new Error("the upload panel is not open");
  return input;
}

/** Choose files, the way the operating system's picker delivers them. */
async function pick(files: File[]) {
  const input = picker();
  Object.defineProperty(input, "files", { value: asFileList(files), configurable: true });
  await act(async () => {
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

/** The names the panel is currently holding, in order. */
function queued(): string[] {
  return [...host.querySelectorAll("li button[aria-label^='Remove ']")].map(
    (b) => (b.getAttribute("aria-label") ?? "").replace(/^Remove /, ""),
  );
}

beforeEach(() => {
  // React 19 only flushes work inside `act` when the environment declares itself one.
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  get.mockReset();
  submitAssignment.mockReset();
  getMySubmission.mockReset();
  serveHomework();
  getMySubmission.mockResolvedValue(MY_SUBMISSION);
  submitAssignment.mockResolvedValue({ ok: true });
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

/** Mount the student's homework page and open the upload panel. */
async function openPanel() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  await act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        <AssignmentDetailPage classId={34} assignmentId={102} />
      </QueryClientProvider>,
    );
  });
  for (let tick = 0; tick < 50 && !text().includes("Upload work"); tick++) {
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  }
  await act(async () => buttonWith("Upload work").click());
}

describe("a student choosing files in two goes", () => {
  it("adds the second pick to the first instead of replacing it", async () => {
    await openPanel();

    await pick([
      fakeFile("page1.jpg", 2 * MB),
      fakeFile("page2.jpg", 2 * MB),
      fakeFile("page3.jpg", 2 * MB),
      fakeFile("page4.jpg", 2 * MB),
    ]);
    expect(queued()).toHaveLength(4);

    // A second trip through the picker — another folder, holding the PDFs.
    await pick([
      fakeFile("q1.pdf", 1 * MB),
      fakeFile("q2.pdf", 1 * MB),
      fakeFile("q3.pdf", 1 * MB),
      fakeFile("q4.pdf", 1 * MB),
      fakeFile("q5.pdf", 1 * MB),
      fakeFile("q6.pdf", 1 * MB),
    ]);

    expect(queued()).toEqual([
      "page1.jpg", "page2.jpg", "page3.jpg", "page4.jpg",
      "q1.pdf", "q2.pdf", "q3.pdf", "q4.pdf", "q5.pdf", "q6.pdf",
    ]);
    expect(text()).toContain("10 files ready");
  });

  it("queues the same file once, however many times it is picked", async () => {
    await openPanel();

    await pick([fakeFile("essay.pdf", 3 * MB)]);
    await pick([fakeFile("essay.pdf", 3 * MB), fakeFile("notes.pdf", 1 * MB)]);

    expect(queued()).toEqual(["essay.pdf", "notes.pdf"]);
  });

  it("takes one file back out and leaves the rest where they were", async () => {
    await openPanel();
    await pick([
      fakeFile("page1.jpg", 1 * MB),
      fakeFile("page2.jpg", 1 * MB),
      fakeFile("page3.jpg", 1 * MB),
    ]);

    const remove = host.querySelector("li button[aria-label='Remove page2.jpg']") as HTMLButtonElement;
    await act(async () => remove.click());

    expect(queued()).toEqual(["page1.jpg", "page3.jpg"]);
  });
});

describe("the limits, answered before anything is sent", () => {
  it("holds back a file that is bigger than one file may be, and names it", async () => {
    await openPanel();
    await pick([fakeFile("scan.pdf", SERVED_LIMITS.max_file_bytes + 10 * MB), fakeFile("notes.pdf", 1 * MB)]);

    await act(async () => buttonWith("Submit homework").click());

    expect(submitAssignment).not.toHaveBeenCalled();
    expect(text()).toContain("“scan.pdf” is 60 MB");
    expect(text()).toContain("Each file can be up to 50 MB");
  });

  it("holds back a batch the proxy would drop, at the size the server reports", async () => {
    await openPanel();
    // Three 25 MB scans: every file is well under the per-file limit, and the total sails past
    // what one request may carry. Nothing about this is obvious from the files themselves.
    await pick([
      fakeFile("scan-a.pdf", 25 * MB),
      fakeFile("scan-b.pdf", 25 * MB),
      fakeFile("scan-c.pdf", 25 * MB),
    ]);

    await act(async () => buttonWith("Submit homework").click());

    expect(submitAssignment).not.toHaveBeenCalled();
    expect(text()).toContain("These come to 75 MB together");
    expect(text()).toContain("One upload carries 60 MB");
  });

  it("counts the file already turned in towards the submission's limit", async () => {
    await openPanel();
    // One file is already on this submission, so the fiftieth new one is the fifty-first in all.
    await pick(
      Array.from({ length: SERVED_LIMITS.max_files_per_submission }, (_, i) =>
        fakeFile(`p${i}.jpg`, 1024, 1_700_000_000_000 + i)),
    );

    await act(async () => buttonWith("Submit homework").click());

    expect(submitAssignment).not.toHaveBeenCalled();
    expect(text()).toContain(
      `That would make ${SERVED_LIMITS.max_files_per_submission + 1} files on this submission`,
    );
  });

  it("holds back a file of a kind the server would refuse, before the other nine go with it", async () => {
    await openPanel();
    // The server validates types first and answers 400 on the first bad one, so this .heic from
    // an iPhone would have cost the student all ten files at the end of the upload.
    await pick([
      ...Array.from({ length: 9 }, (_, i) => fakeFile(`page${i}.jpg`, MB, 1_700_000_000_000 + i)),
      fakeFile("IMG_0421.heic", 2 * MB),
    ]);

    await act(async () => buttonWith("Submit homework").click());

    expect(submitAssignment).not.toHaveBeenCalled();
    expect(text()).toContain("“IMG_0421.heic” isn’t a kind of file this takes");
    // And the picker asks for the right kinds up front.
    expect(picker().getAttribute("accept")).toContain(".pdf");
    expect(picker().getAttribute("accept")).not.toContain(".heic");
  });

  it("follows the limits the server reports, not a set of its own", async () => {
    // Ops have lowered the batch ceiling. 27 MB would pass every built-in default.
    serveHomework({ ...SERVED_LIMITS, max_batch_bytes: 20 * MB });
    await openPanel();
    await pick([
      fakeFile("a.pdf", 9 * MB),
      fakeFile("b.pdf", 9 * MB),
      fakeFile("c.pdf", 9 * MB),
    ]);

    await act(async () => buttonWith("Submit homework").click());

    expect(submitAssignment).not.toHaveBeenCalled();
    expect(text()).toContain("One upload carries 20 MB");
  });
});

describe("the submit that already worked", () => {
  it("sends every queued file with its own token, under the revision guard", async () => {
    await openPanel();
    await pick([fakeFile("page1.jpg", 2 * MB), fakeFile("page2.jpg", 2 * MB), fakeFile("q1.pdf", 1 * MB)]);

    await act(async () => buttonWith("Submit homework").click());

    expect(submitAssignment).toHaveBeenCalledTimes(1);
    const [classId, assignmentId, fd] = submitAssignment.mock.calls[0] as [number, number, FormData];
    expect([classId, assignmentId]).toEqual([34, 102]);
    expect(fd.getAll("files").map((f) => (f as File).name)).toEqual(["page1.jpg", "page2.jpg", "q1.pdf"]);
    expect(fd.get("submit")).toBe("true");
    expect(fd.get("expected_revision")).toBe("3");

    const tokens = JSON.parse(String(fd.get("file_tokens"))) as string[];
    expect(tokens).toHaveLength(3);
    expect(new Set(tokens).size).toBe(3);
  });

  it("still works against a backend that reports no limits at all", async () => {
    // An older deployment: the panel falls back rather than refusing every file it is given.
    serveHomework(null);
    await openPanel();
    await pick([fakeFile("essay.pdf", 3 * MB)]);

    await act(async () => buttonWith("Submit homework").click());

    expect(submitAssignment).toHaveBeenCalledTimes(1);
  });
});
