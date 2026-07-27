"use client";

import { useParams } from "next/navigation";

import { MatchingMode } from "@/features/vocabulary/modes";

export default function VocabularyMatchingPage() {
  const { setId } = useParams();
  return <MatchingMode setId={Number(Array.isArray(setId) ? setId[0] : setId)} />;
}
