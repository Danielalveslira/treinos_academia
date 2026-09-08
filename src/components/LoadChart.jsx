import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'
import { Text } from '@primer/react'

export function LoadChart({ data, dataKey = 'weight', label = 'Carga (kg)' }) {
  if (data.length < 2) {
    return <Text sx={{ color: 'fg.muted', fontSize: 1 }}>Registre ao menos 2 treinos para ver a evolução.</Text>
  }

  return (
    <ResponsiveContainer width="100%" height={220}>
      <LineChart data={data} margin={{ top: 8, right: 16, left: -16, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--borderColor-default)" />
        <XAxis dataKey="date" tick={{ fontSize: 12 }} stroke="var(--fgColor-muted)" />
        <YAxis tick={{ fontSize: 12 }} stroke="var(--fgColor-muted)" />
        <Tooltip formatter={(value) => [value, label]} />
        <Line type="monotone" dataKey={dataKey} stroke="var(--fgColor-accent)" strokeWidth={2} dot={{ r: 3 }} />
      </LineChart>
    </ResponsiveContainer>
  )
}
