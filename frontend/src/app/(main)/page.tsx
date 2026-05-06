import { headers } from "next/headers";
import { HomeDashboard } from "@/components/dashboard";
import QuestionBankPage from "@/features/questionBank/QuestionBankPage";
import { isQuestionsHost } from "@/lib/hostConsole";

export default async function DashboardPage() {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  if (isQuestionsHost(host)) {
    return <QuestionBankPage />;
  }
  return <HomeDashboard />;
}
