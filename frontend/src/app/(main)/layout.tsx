import { headers } from "next/headers";
import AuthGuard from "@/components/AuthGuard";
import QuestionsConsoleChrome from "@/components/QuestionsConsoleChrome";
import StudentShell from "@/components/StudentShell";
import { isQuestionsHost } from "@/lib/hostConsole";

export default async function MainLayout({ children }: { children: React.ReactNode }) {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  if (isQuestionsHost(host)) {
    return (
      <AuthGuard>
        <QuestionsConsoleChrome>{children}</QuestionsConsoleChrome>
      </AuthGuard>
    );
  }
  return <StudentShell>{children}</StudentShell>;
}
