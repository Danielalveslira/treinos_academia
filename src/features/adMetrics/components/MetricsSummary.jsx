import { Box, Text } from '@primer/react'
import { formatCount, formatPercent } from '../utils/metrics'

function Card({ label, value, hint }) {
  return (
    <Box
      sx={{
        p: 3,
        borderRadius: 2,
        border: '1px solid',
        borderColor: 'border.default',
        bg: 'canvas.subtle',
        minWidth: 0,
      }}
    >
      <Text sx={{ display: 'block', fontSize: 0, color: 'fg.muted' }}>{label}</Text>
      <Text
        sx={{
          display: 'block',
          fontSize: [4, 5],
          fontWeight: 'bold',
          lineHeight: 1.2,
          mt: 1,
          overflowWrap: 'anywhere',
        }}
      >
        {value}
      </Text>
      {hint && <Text sx={{ display: 'block', fontSize: 0, color: 'fg.muted', mt: 1 }}>{hint}</Text>}
    </Box>
  )
}

// Quatro cartões principais + área secundária. Tudo vem pronto da RPC (summary); CTR sem impressões aparece como "—".
export function MetricsSummary({ summary }) {
  return (
    <Box sx={{ mb: 3 }}>
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: ['repeat(2, minmax(0, 1fr))', null, 'repeat(4, minmax(0, 1fr))'],
          gap: 2,
        }}
      >
        <Card
          label="Impressões visíveis"
          value={formatCount(summary.visible_impressions)}
          hint="≥ 50% visível por 1 s"
        />
        <Card
          label="Alcance diário agregado"
          value={formatCount(summary.unique_viewers)}
          hint="soma dos únicos de cada dia"
        />
        <Card
          label="Cliques"
          value={formatCount(summary.clicks)}
          hint={`${formatCount(summary.qualified_clicks)} com impressão registrada`}
        />
        <Card
          label="CTR qualificado"
          value={formatPercent(summary.ctr_qualified)}
          hint="cliques qualificados ÷ impressões"
        />
      </Box>
      <Box as="details" sx={{ mt: 2, fontSize: 1 }}>
        <Text
          as="summary"
          sx={{
            cursor: 'pointer',
            color: 'fg.muted',
            minHeight: 32,
            display: 'flex',
            alignItems: 'center',
          }}
        >
          Mais indicadores e definições
        </Text>
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: ['1fr', null, 'repeat(3, 1fr)'],
            gap: 2,
            mt: 1,
          }}
        >
          <Card
            label="Cliques sem impressão registrada"
            value={formatCount(summary.unqualified_clicks)}
            hint="Podem incluir cliques rápidos legítimos (antes de 1 s visível); não são tratados como fraude."
          />
          <Card
            label="Cliques qualificados"
            value={formatCount(summary.qualified_clicks)}
            hint="cliques − cliques sem impressão registrada"
          />
          <Card
            label="CTR bruto"
            value={formatPercent(summary.ctr_raw)}
            hint="cliques totais ÷ impressões; pode passar de 100%"
          />
        </Box>
        <Text sx={{ display: 'block', mt: 2, color: 'fg.muted', fontSize: 0 }}>
          “Alcance diário agregado” soma os únicos de cada dia: a mesma pessoa pode contar em dias,
          comunidades e posicionamentos diferentes, então <b>não</b> é “pessoas únicas no período”.
        </Text>
      </Box>
      <Text sx={{ display: 'block', mt: 2, color: 'fg.muted', fontSize: 0 }}>
        Estimativas operacionais medidas pelo app. Não são conversões, vendas, receita nem
        comprovação de entrega para cobrança, e cliques não são visitas.
      </Text>
    </Box>
  )
}
