import AuthGuard from "@/components/AuthGuard";
import QuestionsConsoleChrome from "@/components/QuestionsConsoleChrome";

export default function QuestionsLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthGuard>
      <QuestionsConsoleChrome>{children}</QuestionsConsoleChrome>
    </AuthGuard>
  );
}
