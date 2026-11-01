"use client";

import { Bar, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { ChartSkeleton, ChartTooltip } from "@/components/ui/charts";
import { CHART_GRID, axisTick } from "@/components/ui/charts/palette";
import { useChartReady } from "@/components/ui/charts/useChartReady";
import { TONE_COLOR } from "../look";
import type { SmsStatsDay } from "../smsApi";
import { deliveryRows } from "./rows";

export type DeliveryChartProps = { data: SmsStatsDay[]; height?: number };

/**
 * Each day's SMS by how they ended (stacked), and the share delivered on its own axis — as a dot per
 * day, and only on days with enough SMS for a share to mean something (`deliveryRows`).
 */
export function DeliveryChartImpl({ data, height = 260 }: DeliveryChartProps) {
  const ready = useChartReady();
  if (!ready) return <ChartSkeleton height={height} />;
  const rows = deliveryRows(data);
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
          <Line
            yAxisId="rate"
            type="linear"
            dataKey="percent"
            name="Delivered %"
            stroke="var(--sms-accent)"
            strokeWidth={2}
            dot={{ r: 3, fill: "var(--sms-accent)", strokeWidth: 0 }}
            connectNulls={false}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
