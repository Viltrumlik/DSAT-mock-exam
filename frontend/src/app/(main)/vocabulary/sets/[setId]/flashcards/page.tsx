"use client";

import { useParams } from "next/navigation";

import { FlashcardMode } from "@/features/vocabulary/modes";

export default function VocabularyFlashcardsPage() {
  const { setId } = useParams();
  return <FlashcardMode setId={Number(Array.isArray(setId) ? setId[0] : setId)} />;
}
