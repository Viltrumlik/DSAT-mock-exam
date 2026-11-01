"use client";

import { Bar, BarChart, CartesianGrid, Cell, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { ChartSkeleton, ChartTooltip } from "@/components/ui/charts";
import { CHART_GRID, axisTick } from "@/components/ui/charts/palette";
import { useChartReady } from "@/components/ui/charts/useChartReady";
import { operatorColor } from "../look";
import type { SmsStatsOperator } from "../smsApi";

export type OperatorChartProps = { data: SmsStatsOperator[]; height?: number };

/** The share each operator delivered, in its own colour, with how many SMS it carried beside the name. */
export function OperatorChartImpl({ data, height = 220 }: OperatorChartProps) {
  const ready = useChartReady();
  if (!ready) return <ChartSkeleton height={height} />;
  const rows = data.map((d) => ({
    ...d,
    name: `${d.operator} (${d.total})`,
    percent: d.rate === null ? 0 : Math.round(d.rate * 100),
  }));
  return (
    <div style={{ width: "100%", height }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 36, left: 8, bottom: 0 }}>
          <CartesianGrid stroke={CHART_GRID} horizontal={false} />
          <XAxis type="number" domain={[0, 100]} tick={axisTick} axisLine={false} tickLine={false} unit="%" />
          <YAxis type="category" dataKey="name" tick={axisTick} axisLine={false} tickLine={false} width={112} />
          <Tooltip content={<ChartTooltip valueFormatter={(v) => `${v}% delivered`} />} cursor={{ fill: CHART_GRID }} />
          <Bar dataKey="percent" name="Delivered" radius={[0, 4, 4, 0]} maxBarSize={22}>
            {rows.map((d) => (
              <Cell key={d.operator} fill={operatorColor(d.operator)} />
            ))}
            <LabelList dataKey="percent" position="right" formatter={(v: number) => `${v}%`} style={axisTick} />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
