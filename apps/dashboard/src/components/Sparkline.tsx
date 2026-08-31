"use client";

import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export interface SparkPoint {
  x: number | string;
  y: number;
}

export function Sparkline({
  data,
  color = "var(--color-viz-1)",
  height = 64,
}: {
  data: SparkPoint[];
  color?: string;
  height?: number;
}) {
  if (!data.length) return <div className="text-xs text-muted">no data yet</div>;
  const id = `spark-${Math.random().toString(36).slice(2)}`;
  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.35} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <XAxis dataKey="x" hide />
          <YAxis hide domain={["dataMin", "dataMax"]} />
          <Tooltip
            contentStyle={{
              background: "#121722",
              border: "1px solid #222b3a",
              borderRadius: 8,
              fontSize: 12,
            }}
            labelStyle={{ color: "#7a8aa0" }}
          />
          <Area type="monotone" dataKey="y" stroke={color} strokeWidth={1.5} fill={`url(#${id})`} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
