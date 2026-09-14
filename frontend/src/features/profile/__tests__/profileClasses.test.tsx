import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { parseClassroomList } from "@/lib/criticalApiContract";

/**
 * The profile's Classes tab: which of the user's classes it lists.
 *
 * `GET /api/classes/` returns only classes the user holds a non-removed membership in, and
 * `my_role` is that membership's role: ADMIN, OWNER, TEACHER, TA or STUDENT. The tab used to keep
 * `student` and `admin` — which, when the filter was written, were the only roles there were, so
 * it meant "every class you are in". The OWNER, TEACHER and TA seats arrived later (June 2026)
 * and fell out of the list. Teachers reach this page too (the teacher shell's profile link
 * is `/profile`), and a teacher-only user was told "No classes yet", while the page still
 * selected their first class and listed its students under "No class selected".
 */

const classes = vi.hoisted(() => ({
  list: vi.fn(),
  listAssignments: vi.fn(),
  getMySubmission: vi.fn(),
  people: vi.fn(),
}));
const users = vi.hoisted(() => ({
  getMe: vi.fn(),
  getTelegramWidgetConfig: vi.fn(),
  listExamDates: vi.fn(),
}));
const auth = vi.hoisted(() => ({ getSessions: vi.fn() }));

vi.mock("@/lib/api", () => ({ authApi: auth, classesApi: classes, usersApi: users }));
vi.mock("@/features/examsStudent/api", () => ({ examsStudentApi: { getAttempts: async () => ({ items: [] }) } }));
vi.mock("@/features/rewards/rewardsApi", () => ({ rewardsApi: { me: async () => null } }));
// Not on the Classes tab; stubbed so their own data layers stay out of this test.
vi.mock("@/features/notifications/NotificationPreferencesCard", () => ({ NotificationPreferencesCard: () => null }));
vi.mock("@/components/EmailVerificationModal", () => ({ EmailVerificationModal: () => null }));
vi.mock("@/components/TelegramLoginButton", () => ({ default: () => null }));

const { default: ProfilePage } = await import("@/app/(main)/profile/page");

/** A `GET /api/classes/` row in the serializer's wire shape. */
function classRow(id: number, name: string, myRole: string | null) {
  return {
    id,
    name,
    subject: "MATH",
    lesson_days: "ODD",
    lesson_time: "18:00",
    start_date: "2026-09-01",
    join_code: `JOIN${id}`,
    members_count: 3,
    teacher_details: null,
    my_role: myRole,
  };
}

let host: HTMLDivElement;
let root: Root;

async function tick(until: () => boolean) {
  for (let i = 0; i < 50 && !until(); i++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
  if (!until()) throw new Error("the page never got there");
}

/** The class names on the Classes tab's cards, in order. */
function listedClasses(): string[] {
  return [...host.querySelectorAll("button")]
    .filter((b) => b.textContent?.includes("Teacher:"))
    .map((b) => b.querySelector("p")?.textContent ?? "");
}

beforeEach(() => {
  // React 19 only flushes work inside `act` when the environment declares itself one.
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  users.getMe.mockResolvedValue({
    id: 1,
    username: "dilnoza",
    first_name: "Dilnoza",
    last_name: "Rashidova",
    email: "dilnoza@example.com",
    email_verified: true,
    telegram_linked: false,
    sat_exam_date: null,
    target_score: null,
    profile_image_url: null,
    last_mock_result: null,
  });
  users.getTelegramWidgetConfig.mockResolvedValue({ enabled: false, bot_username: null, client_id: null, start_url: null });
  users.listExamDates.mockResolvedValue([]);
  auth.getSessions.mockResolvedValue({ sessions: [] });
  classes.listAssignments.mockResolvedValue({ items: [] });
  classes.getMySubmission.mockResolvedValue(null);
  classes.people.mockResolvedValue([
    { id: 1, role: "TEACHER", user: { id: 1, username: "dilnoza", first_name: "Dilnoza", last_name: "Rashidova" } },
    { id: 2, role: "STUDENT", user: { id: 601, username: "aziza", first_name: "Aziza", last_name: "Karimova" } },
  ]);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.clearAllMocks();
});

describe("ProfilePage — the Classes tab", () => {
  it("lists every class the user is a member of, whatever the seat, and opens the first", async () => {
    classes.list.mockImplementation(async () =>
      parseClassroomList(
        [
          // First, so it is the class the page selects on load.
          classRow(3, "Geometry", "TEACHER"),
          classRow(5, "SAT Math", "STUDENT"),
          classRow(1, "Algebra 1", "OWNER"),
          classRow(2, "Statistics", "ADMIN"),
          classRow(4, "Reading", "TA"),
          // The server never lists a class without a membership; if a row ever came with no
          // role, it is still not one of the user's classes.
          classRow(6, "Not mine", null),
        ],
        "GET /classes/",
      ),
    );

    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => root.render(<ProfilePage />));
    await tick(() => host.querySelector('[role="tab"]') != null);

    const classesTab = [...host.querySelectorAll('[role="tab"]')].find((t) => t.textContent?.includes("Classes"));
    await act(async () => (classesTab as HTMLButtonElement).click());
    await tick(() => host.textContent?.includes("Classmates") === true && host.querySelector(".animate-spin") == null);

    expect(listedClasses()).toEqual(["Geometry", "SAT Math", "Algebra 1", "Statistics", "Reading"]);
    expect(host.textContent).toContain("5 enrolled");
    // The class the page opened is on the list, so the classmates card names it.
    expect(host.textContent).not.toContain("No class selected");
    expect(host.textContent).toContain("Aziza Karimova");
    expect(classes.people).toHaveBeenCalledWith(3);
  });
});
