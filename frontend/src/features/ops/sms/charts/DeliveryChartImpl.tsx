"use client";

import { Bar, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { ChartSkeleton, ChartTooltip } from "@/components/ui/charts";
import { CHART_GRID, axisTick } from "@/components/ui/charts/palette";
import { useChartReady } from "@/components/ui/charts/useChartReady";
import { TONE_COLOR } from "../look";
import type { SmsStatsDay } from "../smsApi";

export type DeliveryChartProps = { data: SmsStatsDay[]; height?: number };

/** "2026-11-01" → "1 Nov". */
const dayTick = (day: string) => {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
};

/** Each day's SMS by how they ended (stacked), and the share delivered as a line on its own axis. */
export function DeliveryChartImpl({ data, height = 260 }: DeliveryChartProps) {
  const ready = useChartReady();
  if (!ready) return <ChartSkeleton height={height} />;
  const rows = data.map((d) => ({ ...d, label: dayTick(d.day), percent: d.rate === null ? null : Math.round(d.rate * 100) }));
  return (
    <div style={{ width: "100%", height }}>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={rows} margin={{ top: 8, right: 4, left: -12, bottom: 0 }}>
          <CartesianGrid stroke={CHART_GRID} vertical={false} />
          <XAxis dataKey="label" tick={axisTick} axisLine={false} tickLine={false} dy={6} minTickGap={12} />
          <YAxis yAxisId="count" tick={axisTick} axisLine={false} tickLine={false} width={40} allowDecimals={false} />
          <YAxis yAxisId="rate" orientation="right" domain={[0, 100]} tick={axisTick} axisLine={false} tickLine={false} width={36} unit="%" />
          <Tooltip content={<ChartTooltip />} cursor={{ fill: CHART_GRID }} />
          <Bar yAxisId="count" dataKey="delivered" name="Delivered" stackId="day" fill={TONE_COLOR.delivered} maxBarSize={36} />
          <Bar yAxisId="count" dataKey="undelivered" name="Not delivered" stackId="day" fill={TONE_COLOR.undelivered} maxBarSize={36} />
          <Bar yAxisId="count" dataKey="rejected" name="Refused" stackId="day" fill={TONE_COLOR.rejected} radius={[4, 4, 0, 0]} maxBarSize={36} />
          <Line yAxisId="rate" type="monotone" dataKey="percent" name="Delivered %" stroke="var(--sms-accent)" strokeWidth={2} dot={false} connectNulls />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
