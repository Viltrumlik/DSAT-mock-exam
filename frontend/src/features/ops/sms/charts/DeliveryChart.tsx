"use client";

import dynamic from "next/dynamic";

import { ChartSkeleton } from "@/components/ui/charts";

export type { DeliveryChartProps } from "./DeliveryChartImpl";

/** Recharts loads on demand, as the shared chart kit does (`@/components/ui/charts`). */
export const DeliveryChart = dynamic(() => import("./DeliveryChartImpl").then((m) => m.DeliveryChartImpl), {
  ssr: false,
  loading: () => <ChartSkeleton height={260} />,
});
