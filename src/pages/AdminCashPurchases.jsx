import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Box, Button, Flash, FormControl, Heading, Label, Select, Spinner, Text } from '@primer/react'
import { useAuth } from '../hooks/useAuth'
import { useCashPurchases } from '../hooks/useCashPurchases'
import { useUsernamesByIds } from '../hooks/useUsernamesByIds'
import { formatCentavosBRL, formatDateTime } from '../utils/format'
import { cashPurchaseStatusLabel, ADMIN_CASH_PURCHASE_STATUS_LABELS as STATUS_LABELS } from '../utils/cashPurchaseFlow'

function date(value) {
  return formatDateTime(value ? new Date(value) : null)
}

export default function AdminCashPurchases() {
  const { user } = useAuth()
  const [status, setStatus] = useState('pending')
  const { purchases, loading, hasMore, loadMore, error, refresh } = useCashPurchases(user.uid, true, status)
  const usernames = useUsernamesByIds(purchases.map((purchase) => purchase.userId))

  return (
    <div className="support-page">
      <h1>Compras de EvoCash</h1>
      <Text as="p">Histórico de compras e conciliação automática de pagamentos.</Text>
      <FormControl sx={{ mb: 3 }}>
        <FormControl.Label>Mostrar compras</FormControl.Label>
        <Select value={status} onChange={(event) => setStatus(event.target.value)}>
          <Select.Option value="pending">Pendentes</Select.Option>
          <Select.Option value="paid">Pagos</Select.Option>
          <Select.Option value="cancelled">Cancelados</Select.Option>
          <Select.Option value="failed">Falhas</Select.Option>
          <Select.Option value="">Todos</Select.Option>
        </Select>
      </FormControl>
      {loading && purchases.length === 0 && <Spinner aria-label="Carregando compras" />}
      {error && <Flash variant="danger" sx={{ mb: 3 }}>{error} <Button onClick={refresh}>Tentar novamente</Button></Flash>}
      {!loading && purchases.length === 0 && !error && <Text as="p">Nenhuma compra encontrada para este filtro.</Text>}
      {purchases.map((purchase) => (
        <Box as="article" key={purchase.id} sx={{ border: '1px solid', borderColor: 'border.default', borderRadius: 2, p: 3, mb: 3, overflowWrap: 'anywhere' }}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 2 }}>
            <Heading as="h2" sx={{ fontSize: 1 }}>{purchase.packageLabel}</Heading>
            <Label variant={cashPurchaseStatusLabel(purchase, STATUS_LABELS).variant}>
              {cashPurchaseStatusLabel(purchase, STATUS_LABELS).text}
            </Label>
          </Box>
          <Text as="p" sx={{ m: 0 }}>{formatCentavosBRL(purchase.amountCentavos)} · {purchase.cashAmount} EvoCash</Text>
          <Text as="p" sx={{ fontSize: 0, color: 'fg.muted' }}>
            Protocolo: {purchase.id}<br />
            Usuário: {purchase.userId ? (usernames[purchase.userId] ? `@${usernames[purchase.userId]} · ${purchase.userId}` : purchase.userId) : 'Conta excluída'}<br />
            Provider: {purchase.paymentProvider === 'infinitepay' ? 'InfinitePay' : 'Mercado Pago'}<br />
            Order NSU: {purchase.orderNsu || '—'}<br />
            Transaction NSU: {purchase.transactionNsu || '—'}<br />
            Forma de pagamento: {purchase.captureMethod || '—'}<br />
            Criada: {date(purchase.createdAt)}<br />
            Creditada: {date(purchase.creditedAt)}<br />
            Cancelada: {date(purchase.cancelledAt)}
          </Text>
          {purchase.paidAfterCancelAt && <Text as="p" sx={{ color: 'attention.fg', fontWeight: 'bold' }}>
            Pago após cancelamento: {date(purchase.paidAfterCancelAt)}
          </Text>}
          {purchase.userId && <Link to={`/admin/contas?usuario=${encodeURIComponent(purchase.userId)}`}>Ver conta do comprador</Link>}
        </Box>
      ))}
      {hasMore && <Button onClick={loadMore} disabled={loading}>Carregar mais compras</Button>}
    </div>
  )
}
