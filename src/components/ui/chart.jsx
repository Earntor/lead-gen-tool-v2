"use client"

import {
  LineChart,
  Line,
  BarChart,
  Bar,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts"
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card"

// 🔹 Basis component voor uniforme stijl
function ChartWrapper({ title, children }) {
  return (
    <Card className="w-full shadow-sm rounded-2xl border border-gray-100">
      <CardHeader>
        <CardTitle className="text-lg font-semibold">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            {children}
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  )
}

// 🔹 Lijngrafiek
export function LineChartComponent({ title = "Lijngrafiek", data }) {
  return (
    <ChartWrapper title={title}>
      <LineChart data={data} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" className="stroke-gray-200" />
        <XAxis dataKey="name" stroke="#888" />
        <YAxis stroke="#888" />
        <Tooltip />
        <Legend />
        <Line type="monotone" dataKey="value" stroke="#3b82f6" strokeWidth={2} dot={{ r: 4 }} />
      </LineChart>
    </ChartWrapper>
  )
}

// 🔹 Balkgrafiek
export function BarChartComponent({ title = "Balkgrafiek", data }) {
  return (
    <ChartWrapper title={title}>
      <BarChart data={data} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" className="stroke-gray-200" />
        <XAxis dataKey="name" stroke="#888" />
        <YAxis stroke="#888" />
        <Tooltip />
        <Legend />
        <Bar dataKey="value" fill="#3b82f6" radius={[6, 6, 0, 0]} />
      </BarChart>
    </ChartWrapper>
  )
}

// 🔹 Gebiedgrafiek
export function AreaChartComponent({ title = "Gebiedgrafiek", data }) {
  return (
    <ChartWrapper title={title}>
      <AreaChart data={data} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id="colorValue" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.8} />
            <stop offset="95%" stopColor="#3b82f6" stopOpacity={0.1} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" className="stroke-gray-200" />
        <XAxis dataKey="name" stroke="#888" />
        <YAxis stroke="#888" />
        <Tooltip />
        <Legend />
        <Area type="monotone" dataKey="value" stroke="#3b82f6" fillOpacity={1} fill="url(#colorValue)" />
      </AreaChart>
    </ChartWrapper>
  )
}

// 🔹 Horizontale balkgrafiek (industrieën/labels met lange namen)
export function BarChartHorizontalComponent({ title = "Industrieën", data }) {
  return (
    <ChartWrapper title={title}>
      <BarChart
        data={data}
        layout="vertical"
        margin={{ top: 10, right: 20, left: 0, bottom: 0 }}
      >
        <CartesianGrid horizontal={false} className="stroke-gray-200" />
        {/* Y-as: categorie labels */}
        <YAxis
          dataKey="name"
          type="category"
          tickLine={false}
          axisLine={false}
          width={160} // geef ruimte aan lange labels
        />
        {/* X-as: aantallen */}
        <XAxis type="number" stroke="#888" />
        <Tooltip />
        <Legend />
        <Bar
          dataKey="value"
          fill="#3b82f6"            // evt. themable maken: fill="var(--chart-2)"
          radius={[6, 6, 6, 6]}
        />
      </BarChart>
    </ChartWrapper>
  )
}