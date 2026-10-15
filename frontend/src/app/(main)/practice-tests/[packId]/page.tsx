import { redirect } from "next/navigation";

/** Packs were retired (2026-10-15): a practice test is one section now. Old links land on the list. */
export default function RetiredPackPage() {
  redirect("/practice-tests");
}
