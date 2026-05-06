import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { isQuestionsHost } from "@/lib/hostConsole";

export default async function VocabularyAdminLayout({ children }: { children: React.ReactNode }) {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  if (!isQuestionsHost(host)) redirect("/vocabulary");
  return <>{children}</>;
}
