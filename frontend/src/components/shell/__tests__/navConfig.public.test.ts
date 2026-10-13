import { describe, expect, it } from "vitest";
import { flattenNav, publicStudentNav, studentNav } from "@/components/shell/navConfig";

describe("publicStudentNav", () => {
  it("keeps Mock Exam, Events and Profile only", () => {
    const hrefs = flattenNav(publicStudentNav(studentNav)).map((i) => i.href).sort();
    expect(hrefs).toEqual(["/events", "/mock-exam", "/profile"]);
  });

  it("collapses a group left with one route into that route", () => {
    const items = publicStudentNav(studentNav).flatMap((s) => s.items);
    const mock = items.find((i) => i.href === "/mock-exam");
    expect(mock).toBeDefined();
    expect(items.some((i) => i.children?.length)).toBe(false);
  });

  it("leaves the learning center's nav untouched", () => {
    expect(flattenNav(studentNav).some((i) => i.href === "/classes")).toBe(true);
  });
});
