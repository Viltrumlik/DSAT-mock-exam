import AuthGuard from "@/components/AuthGuard";

export default function QuestionsLayout({ children }: { children: React.ReactNode }) {
  return <AuthGuard adminOnly>{children}</AuthGuard>;
}
