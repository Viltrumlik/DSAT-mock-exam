"use client";

import { useParams } from "next/navigation";

import { SpeedMode } from "@/features/vocabulary/modes";

export default function VocabularySpeedPage() {
  const { setId } = useParams();
  return <SpeedMode setId={Number(Array.isArray(setId) ? setId[0] : setId)} />;
}
