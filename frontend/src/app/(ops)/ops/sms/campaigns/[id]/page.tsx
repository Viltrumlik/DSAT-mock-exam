"use client";

import { useParams } from "next/navigation";
import { CampaignPage } from "@/features/ops/sms/CampaignPage";

export default function OpsSmsCampaignPage() {
  const { id } = useParams<{ id: string }>();
  return <CampaignPage id={Number(id)} />;
}
