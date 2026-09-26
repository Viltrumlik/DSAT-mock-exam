/**
 * Publishing a draft from the homework edit form (`AssignmentForm`).
 *
 * The edit body carried every field the teacher had touched except `status`, so a partial
 * update left the row a draft: the primary button said "Save changes", the teacher pressed it
 * expecting the class to get the work, and the homework list went on reading "Not published".
 * A draft's buttons now send the status they mean, and say which one that is.
 *
 * Only a draft's. Sending `status` on every save was the cure that became the next disease:
 * on an archived row the primary button also reads "Save changes", so a typo fix in November
 * carried status: "PUBLISHED" and handed the class its old homework back. A partial update
 * that omits `status` cannot move a row anywhere, which is what a plain save should mean.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const updateAssignment = vi.fn();
const getAssignmentOptions = vi.fn();

vi.mock("@/lib/api", () => ({
  default: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
  classesApi: {
    getAssignmentOptions: (...args: unknown[]) => getAssignmentOptions(...args),
    updateAssignment: (...args: unknown[]) => updateAssignment(...args),
    createAssignment: vi.fn(),
    videoUploadUrl: vi.fn(),
  },
}));

const AssignmentForm = (await import("../pages/AssignmentForm")).default;

/** A homework row as the teaching team receives it, ready for the edit form. */
function editingRow(status: "DRAFT" | "PUBLISHED" | "ARCHIVED") {
  return {
    id: 77,
    title: "Unit 4 preview",
    instructions: "Read pages 20-24.",
    category: "HOMEWORK",
    status,
    allow_file_upload: false,
    external_urls: [],
    external_url_labels: [],
  };
}

let container: HTMLDivElement;
let root: Root;

async function renderForm(status: "DRAFT" | "PUBLISHED" | "ARCHIVED") {
  await act(async () => {
    root.render(
      <AssignmentForm
        classId={34}
        editingAssignment={editingRow(status)}
        onCancel={() => {}}
        onSaved={() => {}}
      />,
    );
  });
}

function buttonLabelled(text: string): HTMLButtonElement | undefined {
  return [...container.querySelectorAll("button")].find(
    (b) => (b.textContent || "").trim() === text,
  ) as HTMLButtonElement | undefined;
}

beforeEach(() => {
  updateAssignment.mockReset();
  updateAssignment.mockResolvedValue({ id: 77, status: "PUBLISHED" });
  getAssignmentOptions.mockReset();
  getAssignmentOptions.mockResolvedValue({
    practice_tests: [],
    assessment_sets: [],
    practice_test_packs: [],
    vocabulary_sections: [],
    classroom_subject: "MATH",
    classroom_level: "senior",
  });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe("AssignmentForm — publishing a draft", () => {
  it("sends status PUBLISHED when the teacher publishes a draft", async () => {
    await renderForm("DRAFT");
    const publish = buttonLabelled("Publish");
    expect(publish, "a draft's primary button should say Publish").toBeTruthy();

    await act(async () => {
      publish!.click();
    });

    expect(updateAssignment).toHaveBeenCalled();
    const body = updateAssignment.mock.calls[0][2] as Record<string, unknown>;
    expect(body.status).toBe("PUBLISHED");
  });

  it("keeps a draft a draft when the teacher saves it as one", async () => {
    await renderForm("DRAFT");
    const saveDraft = buttonLabelled("Save as draft");
    expect(saveDraft, "editing a draft should still offer Save as draft").toBeTruthy();

    await act(async () => {
      saveDraft!.click();
    });

    const body = updateAssignment.mock.calls[0][2] as Record<string, unknown>;
    expect(body.status).toBe("DRAFT");
  });

  it("labels the button on published homework as a save, not a publish", async () => {
    await renderForm("PUBLISHED");
    expect(buttonLabelled("Save changes")).toBeTruthy();
    expect(buttonLabelled("Publish")).toBeUndefined();
    // Taking published work back off the class is a retraction, not something a Save
    // button should do quietly.
    expect(buttonLabelled("Save as draft")).toBeUndefined();
  });

  it("leaves the status alone when saving published homework, instead of restating it", async () => {
    await renderForm("PUBLISHED");
    await act(async () => {
      buttonLabelled("Save changes")!.click();
    });
    const body = updateAssignment.mock.calls[0][2] as Record<string, unknown>;
    // A partial update that omits `status` cannot change it — which is strictly safer than
    // restating a status the teacher never chose. Only a draft's buttons name one.
    expect(body).not.toHaveProperty("status");
  });

  it("cannot republish archived homework from the Save button", async () => {
    await renderForm("ARCHIVED");
    // An archived row is not a draft, so its primary button is a save, not a publish.
    expect(buttonLabelled("Save changes")).toBeTruthy();
    expect(buttonLabelled("Publish")).toBeUndefined();

    await act(async () => {
      buttonLabelled("Save changes")!.click();
    });

    const body = updateAssignment.mock.calls[0][2] as Record<string, unknown>;
    // The regression this guards: a teacher opening November's archived homework to fix a
    // typo would have sent status: "PUBLISHED" and handed the whole class its old work back —
    // with a stale archived_at, and without the pastpaper access _go_live re-grants, so the
    // launcher would be dead. Giving archived work back to a class is the Unarchive action.
    expect(body).not.toHaveProperty("status");
  });
});
