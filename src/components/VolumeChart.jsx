import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'
import { Text } from '@primer/react'

export function VolumeChart({ data }) {
  if (data.length < 2) {
    return <Text sx={{ color: 'fg.muted', fontSize: 1 }}>Registre treinos em datas diferentes para ver o volume.</Text>
  }

  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={data} margin={{ top: 8, right: 16, left: -16, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--borderColor-default)" />
        <XAxis dataKey="date" tick={{ fontSize: 12 }} stroke="var(--fgColor-muted)" />
        <YAxis tick={{ fontSize: 12 }} stroke="var(--fgColor-muted)" />
        <Tooltip formatter={(value) => [value, 'Volume']} />
        <Bar dataKey="volume" fill="var(--fgColor-accent)" radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  )
}
