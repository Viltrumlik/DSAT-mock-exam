import { StandaloneMidtermDetail } from "@/features/midterm/standalone";

export default async function TeacherMidtermDetailPage({ params }: { params: Promise<{ midtermId: string }> }) {
  const { midtermId } = await params;
  return <StandaloneMidtermDetail midtermId={Number(midtermId)} />;
}
