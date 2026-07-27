"use client";

import { useParams } from "next/navigation";
import { SectionSets } from "@/features/vocabulary/pages/SectionSets";

export default function VocabularySectionPage() {
  const params = useParams();
  return <SectionSets sectionId={Number(params?.sectionId)} />;
}
