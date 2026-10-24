import { useEffect, useRef, useState } from 'react'
import { Box, Button, Text } from '@primer/react'
import { adMetricsGeneration } from '../hooks/useAdMetricsDashboard'
import { fetchCompleteReport, reportMatchesSnapshot } from '../api/adMetrics.api'
import { downloadReport, reportCsv, reportPdf, reportUrl } from '../utils/reports'

export function ReportActions({ filters, snapshot, fetcher, onUnauthorized }) {
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const live = useRef(true)
  const request = useRef(0)
  useEffect(() => {
    live.current = true
    return () => {
      live.current = false
      request.current += 1
    }
  }, [])
  useEffect(() => {
    request.current += 1
    setBusy(false)
    setMessage('')
  }, [filters])
  async function exportReport(format) {
    const epoch = adMetricsGeneration()
    const mine = ++request.current
    setBusy(true)
    setMessage('')
    try {
      const full = await fetchCompleteReport(filters, fetcher)
      if (!live.current || mine !== request.current || epoch !== adMetricsGeneration()) return
      if (!reportMatchesSnapshot(full, snapshot))
        throw new Error('Os dados mudaram. Atualize o painel antes de exportar.')
      downloadReport(format === 'csv' ? reportCsv(full) : reportPdf(full), format)
      setMessage('Relatório exportado.')
    } catch (error) {
      if (!live.current || mine !== request.current || epoch !== adMetricsGeneration()) return
      if (error.code === '42501' || /PERMISSION_DENIED/.test(error.message)) onUnauthorized?.()
      setMessage(
        error.code === '42501' ? 'Acesso negado.' : error.message || 'Não foi possível exportar.'
      )
    } finally {
      if (live.current && mine === request.current) setBusy(false)
    }
  }
  return (
    <Box sx={{ mb: 3 }}>
      <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
        {
          <Button
            disabled={busy}
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(reportUrl(filters))
                setMessage('Link copiado. O destinatário precisa entrar e ter autorização.')
              } catch {
                setMessage('Não foi possível copiar o link.')
              }
            }}
          >
            Compartilhar
          </Button>
        }
        <Button disabled={busy || !snapshot} onClick={() => exportReport('csv')}>
          Exportar CSV
        </Button>
        <Button disabled={busy || !snapshot} onClick={() => exportReport('pdf')}>
          Exportar PDF
        </Button>
      </Box>
      <Text role="status" sx={{ display: 'block', mt: 1, fontSize: 0 }}>
        {message}
      </Text>
    </Box>
  )
}
