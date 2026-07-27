"use client";

import { useParams } from "next/navigation";
import { SetOverview } from "@/features/vocabulary/pages/SetOverview";

export default function VocabularySetPage() {
  const params = useParams();
  return <SetOverview setId={Number(params?.setId)} />;
}
