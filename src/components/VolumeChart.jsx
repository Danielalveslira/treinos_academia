import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  LabelList,
} from 'recharts'
import { Text } from '@primer/react'

function formatDateLabel(isoDate) {
  const [, month, day] = isoDate.split('-')
  return `${day}/${month}`
}

export function VolumeChart({ data }) {
  if (data.length < 2) {
    return (
      <Text sx={{ color: 'fg.muted', fontSize: 1 }}>
        Registre treinos em datas diferentes para ver o volume.
      </Text>
    )
  }

  return (
    <ResponsiveContainer width="100%" height={240}>
      <BarChart
        data={data}
        margin={{ top: 24, right: 8, left: -16, bottom: 0 }}
        barCategoryGap="30%"
      >
        <CartesianGrid strokeDasharray="3 3" stroke="var(--borderColor-default)" vertical={false} />
        <XAxis
          dataKey="date"
          tickFormatter={formatDateLabel}
          tick={{ fontSize: 12, fill: 'var(--fgColor-muted)' }}
          axisLine={{ stroke: 'var(--borderColor-default)' }}
          tickLine={false}
        />
        <YAxis
          tick={{ fontSize: 12, fill: 'var(--fgColor-muted)' }}
          axisLine={false}
          tickLine={false}
        />
        <Tooltip
          cursor={{ fill: 'var(--bgColor-neutral-muted)' }}
          labelFormatter={formatDateLabel}
          formatter={(value) => [value, 'Volume']}
          contentStyle={{
            background: 'var(--bgColor-default)',
            border: '1px solid var(--borderColor-default)',
            borderRadius: 6,
            boxShadow: 'var(--shadow-resting-medium)',
            fontSize: 12,
            padding: '6px 10px',
          }}
          labelStyle={{ color: 'var(--fgColor-muted)', marginBottom: 2 }}
          itemStyle={{ color: 'var(--fgColor-default)', padding: 0 }}
        />
        <Bar dataKey="volume" fill="var(--fgColor-accent)" radius={[6, 6, 0, 0]} maxBarSize={56}>
          <LabelList
            dataKey="volume"
            position="top"
            fill="var(--fgColor-default)"
            fontSize={12}
            fontWeight="bold"
          />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}
