"use client";

import { useParams } from "next/navigation";

import { TestMode } from "@/features/vocabulary/modes";

export default function VocabularyTestPage() {
  const { setId } = useParams();
  return <TestMode setId={Number(Array.isArray(setId) ? setId[0] : setId)} />;
}
