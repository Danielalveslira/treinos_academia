import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { formatCount, formatDay } from '../utils/metrics'

const compact = new Intl.NumberFormat('pt-BR', { notation: 'compact', maximumFractionDigits: 1 })
const formatTick = (value) => compact.format(value)
const AXIS = { fontSize: 11, fill: 'var(--fgColor-muted)' }
const TOOLTIP = {
  background: 'var(--bgColor-default)',
  border: '1px solid var(--borderColor-default)',
  borderRadius: 6,
  fontSize: 12,
  padding: '6px 10px',
}

// Carregado sob demanda (React.lazy em AdMetricsTab): só entra no bundle da aba Métricas, nunca no boot.
// Barras = impressões visíveis (eixo esquerdo); linha = cliques (eixo direito, escala própria, porque cliques são
// ordens de grandeza menores). Dias sem registro são null; a linha tem lacunas.
export default function DailyChart({ data, height = 220, mode = 'both' }) {
  const totalImpressions = data.reduce((sum, d) => sum + d.impressions, 0)
  const totalClicks = data.reduce((sum, d) => sum + d.clicks, 0)
  return (
    <div
      role="img"
      aria-label={`Gráfico diário de ${formatCount(totalImpressions)} impressões visíveis e ${formatCount(totalClicks)} cliques em ${data.length} dias`}
      style={{ width: '100%', height }}
    >
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 8, right: 0, left: 0, bottom: 0 }}>
          <CartesianGrid
            strokeDasharray="3 3"
            stroke="var(--borderColor-default)"
            vertical={false}
          />
          <XAxis
            dataKey="day"
            tickFormatter={formatDay}
            tick={AXIS}
            tickLine={false}
            axisLine={{ stroke: 'var(--borderColor-default)' }}
            interval="preserveStartEnd"
            minTickGap={28}
          />
          <YAxis
            yAxisId="imp"
            tick={AXIS}
            tickLine={false}
            axisLine={false}
            allowDecimals={false}
            width={40}
            tickFormatter={formatTick}
          />
          <YAxis
            yAxisId="clk"
            orientation="right"
            tick={AXIS}
            tickLine={false}
            axisLine={false}
            allowDecimals={false}
            width={40}
            tickFormatter={formatTick}
          />
          <Tooltip
            contentStyle={TOOLTIP}
            labelFormatter={(day, items) =>
              `${formatDay(day)}${items?.[0]?.payload?.recorded === false ? ' · sem registro' : ''}`
            }
            formatter={(value, name) => [formatCount(value), name]}
          />
          {mode !== 'clicks' && (
            <Bar
              yAxisId="imp"
              dataKey="impressions"
              name="Impressões visíveis"
              fill="var(--fgColor-accent)"
              radius={[3, 3, 0, 0]}
              maxBarSize={22}
              isAnimationActive={false}
            />
          )}
          {mode !== 'impressions' && (
            <Line
              yAxisId="clk"
              dataKey="clicks"
              name="Cliques"
              stroke="var(--fgColor-success)"
              strokeWidth={2}
              dot={{ r: 2 }}
              isAnimationActive={false}
            />
          )}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  )
}
