import { RoadmapReadingPage } from "@/features/roadmap/RoadmapReadingPage";

export default async function Page({ params }: { params: Promise<{ deliveryId: string }> }) {
  const { deliveryId } = await params;
  return <RoadmapReadingPage deliveryId={Number(deliveryId)} />;
}
