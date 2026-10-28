import { useEffect, useState } from 'react'
import { Box, Button, Flash, Text } from '@primer/react'
import { commercialDate, commercialError } from '../utils/commercial'
export default function CommercialOrderHistory({ resourceId, load, revision }) {
  const [orders, setOrders] = useState([]),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [more, setMore] = useState(false)
  useEffect(() => {
    let active = true
    setOrders([])
    setError('')
    setBusy(true)
    load(resourceId)
      .then((rows) => {
        if (active) {
          setOrders(rows)
          setMore(rows.length === 20)
        }
      })
      .catch((e) => active && setError(commercialError(e)))
      .finally(() => active && setBusy(false))
    return () => {
      active = false
    }
  }, [resourceId, load, revision])
  async function next() {
    if (busy) return
    setBusy(true)
    try {
      const rows = await load(resourceId, orders.at(-1).createdAt)
      setOrders((prev) => [...prev, ...rows])
      setMore(rows.length === 20)
    } catch (e) {
      setError(commercialError(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Box sx={{ mt: 3 }}>
      <Text as="h3" sx={{ fontSize: 2 }}>
        Histórico de contratações
      </Text>
      {error && <Flash variant="danger">{error}</Flash>}
      {!orders.length && !busy && <Text as="p">Nenhuma contratação.</Text>}
      {orders.map((order) => (
        <Text as="p" key={order.id}>
          {order.durationDays} dias · {order.totalCash} EvoCash · {order.status} ·{' '}
          {commercialDate(order.createdAt)}
          {order.periodEnd && ` · até ${commercialDate(order.periodEnd)}`}
        </Text>
      ))}
      {more && (
        <Button disabled={busy} onClick={next}>
          Mais contratos
        </Button>
      )}
    </Box>
  )
}
