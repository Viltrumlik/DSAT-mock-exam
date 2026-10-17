"use client";

import { useParams } from "next/navigation";
import { TelegramPostPage } from "@/features/ops/telegram-posts/TelegramPostPage";

export default function OpsTelegramPostPage() {
  const { id } = useParams<{ id: string }>();
  return <TelegramPostPage id={Number(id)} />;
}
