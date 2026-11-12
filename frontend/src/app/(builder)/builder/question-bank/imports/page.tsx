import { redirect } from "next/navigation";

/**
 * The Review queue and Imports left the Builder on 2026-11-12 (owner: "shu ikkisi umuman kerak emas … pdfdan
 * import qilmayapmiz"). An old link or bookmark lands on the Question bank instead of a broken page.
 */
export default function RemovedQuestionBankPage() {
  redirect("/builder/question-bank");
}
