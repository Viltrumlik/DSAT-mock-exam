import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock the shared axios instance so no real network happens.
const post = vi.fn();
vi.mock("@/lib/api", () => ({ default: { post: (...args: unknown[]) => post(...args) } }));

import { ReportProblemModal } from "./ReportProblemModal";
import { questionReportApi } from "@/lib/questionReportApi";
import { ToastProvider } from "@/components/ToastProvider";

function findButton(label: string): HTMLButtonElement {
  const btn = Array.from(document.body.querySelectorAll("button")).find(
    (b) => b.textContent?.trim() === label,
  );
  if (!btn) throw new Error(`button "${label}" not found`);
  return btn as HTMLButtonElement;
}

describe("questionReportApi.submit", () => {
  beforeEach(() => post.mockReset());

  it("POSTs to the reports endpoint with the payload", async () => {
    post.mockResolvedValue({ data: { id: 7 } });
    const res = await questionReportApi.submit({
      system: "assessment",
      question_id: 99,
      category: "typo_unclear",
      message: "typo in stem",
    });
    expect(res).toEqual({ id: 7 });
    expect(post).toHaveBeenCalledWith("/question-reports/reports/", {
      system: "assessment",
      question_id: 99,
      category: "typo_unclear",
      message: "typo in stem",
    });
  });
});

describe("ReportProblemModal", () => {
  let host: HTMLElement;
  let root: Root;

  beforeEach(() => {
    post.mockReset();
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    document.body.innerHTML = "";
  });

  it("submits the selected question with the default category and closes on success", async () => {
    post.mockResolvedValue({ data: { id: 12 } });
    const onClose = vi.fn();

    await act(async () => {
      root.render(
        <ToastProvider>
          <ReportProblemModal
            open
            onClose={onClose}
            target={{ system: "exam", questionId: 42, attemptId: 5 }}
            questionNumber={3}
          />
        </ToastProvider>,
      );
    });

    // Dialog rendered with its title.
    expect(document.body.textContent).toContain("Report a problem");

    await act(async () => {
      findButton("Send report").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await act(async () => {}); // flush the resolved submit + state updates

    expect(post).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledWith("/question-reports/reports/", {
      system: "exam",
      question_id: 42,
      category: "wrong_answer",
      message: "",
      attempt_id: 5,
    });
    expect(onClose).toHaveBeenCalled();
  });

  it("does not render when closed", async () => {
    await act(async () => {
      root.render(
        <ToastProvider>
          <ReportProblemModal
            open={false}
            onClose={() => {}}
            target={{ system: "exam", questionId: 1 }}
          />
        </ToastProvider>,
      );
    });
    expect(document.body.textContent).not.toContain("Report a problem");
  });
});
