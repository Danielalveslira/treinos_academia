import {
  AreaChart,
  Area,
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

export function LoadChart({ data, dataKey = 'weight', label = 'Carga (kg)' }) {
  if (data.length < 2) {
    return (
      <Text sx={{ color: 'fg.muted', fontSize: 1 }}>
        Registre ao menos 2 treinos para ver a evolução.
      </Text>
    )
  }

  return (
    <ResponsiveContainer width="100%" height={240}>
      <AreaChart data={data} margin={{ top: 24, right: 8, left: -16, bottom: 0 }}>
        <defs>
          <linearGradient id="loadChartFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--fgColor-accent)" stopOpacity={0.25} />
            <stop offset="100%" stopColor="var(--fgColor-accent)" stopOpacity={0} />
          </linearGradient>
        </defs>
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
        <Tooltip labelFormatter={formatDateLabel} formatter={(value) => [value, label]} />
        <Area
          type="monotone"
          dataKey={dataKey}
          stroke="var(--fgColor-accent)"
          strokeWidth={2}
          fill="url(#loadChartFill)"
          dot={{ r: 3, fill: 'var(--fgColor-accent)' }}
          activeDot={{ r: 5 }}
        >
          <LabelList
            dataKey={dataKey}
            position="top"
            fill="var(--fgColor-default)"
            fontSize={12}
            fontWeight="bold"
          />
        </Area>
      </AreaChart>
    </ResponsiveContainer>
  )
}
