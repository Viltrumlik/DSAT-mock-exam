import { PastpaperReportPage } from "@/features/pastpapers/PastpaperReportPage";

export default async function Page({ params }: { params: Promise<{ attemptId: string }> }) {
  const { attemptId } = await params;
  return <PastpaperReportPage attemptId={Number(attemptId)} />;
}
