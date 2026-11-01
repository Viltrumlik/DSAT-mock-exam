"use client";

import dynamic from "next/dynamic";

import { ChartSkeleton } from "@/components/ui/charts";

export type { OperatorChartProps } from "./OperatorChartImpl";

/** Recharts loads on demand, as the shared chart kit does (`@/components/ui/charts`). */
export const OperatorChart = dynamic(() => import("./OperatorChartImpl").then((m) => m.OperatorChartImpl), {
  ssr: false,
  loading: () => <ChartSkeleton height={220} />,
});
