"use client";

import { notFound } from "next/navigation";

import { ToolboxPage } from "@/features/ops/toolbox/ToolboxPage";

/** Only on the test copy, whose build sets NEXT_PUBLIC_STAGING_TOOLBOX=1; prod has no such page. */
export default function OpsToolboxPage() {
  if (process.env.NEXT_PUBLIC_STAGING_TOOLBOX !== "1") notFound();
  return <ToolboxPage />;
}
