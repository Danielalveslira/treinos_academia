import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

const formatKg = (value) => `${Number(value).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} kg`

export function StrengthProgressChart({ data, showEstimate }) {
  return (
    <>
      <div className="progress-chart-legend" aria-label="Legenda do gráfico de força">
        <span><i className="is-current" />Melhor carga</span>
        {showEstimate && <span><i className="is-estimate" />1RM estimado</span>}
      </div>
      <ResponsiveContainer width="100%" height={240}>
        <LineChart data={data} margin={{ top: 12, right: 12, left: -8, bottom: 4 }} accessibilityLayer>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--borderColor-muted)" vertical={false} />
          <XAxis dataKey="label" tickLine={false} axisLine={false} minTickGap={18} />
          <YAxis domain={['auto', 'auto']} tickLine={false} axisLine={false} width={52} />
          <Tooltip formatter={(value, name) => [formatKg(value), name]} />
          <Line type="monotone" name="Melhor carga" dataKey="maxWeightKg" stroke="#2f81f7" strokeWidth={2} dot={{ r: 3 }} isAnimationActive={false} />
          {showEstimate && (
            <Line type="monotone" name="1RM estimado" dataKey="estimated1RMKg" stroke="#a371f7" strokeWidth={2} strokeDasharray="5 4" dot={{ r: 3 }} isAnimationActive={false} />
          )}
        </LineChart>
      </ResponsiveContainer>
    </>
  )
}
