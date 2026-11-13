import React from 'react'
import { createRoot } from 'react-dom/client'
import { ThemeProvider, BaseStyles } from '@primer/react'
import { BrowserRouter } from 'react-router-dom'
import { WalletContext } from '../../src/contexts/WalletContext.jsx'
import { PromoteDialog } from '../../src/components/PromoteDialog.jsx'
import '@primer/primitives/dist/css/functional/themes/light.css'
import '../../src/styles/app.css'
const now = new Date()
const later = (days) => new Date(now.getTime() + days * 86400000).toISOString()
window.__boostCalls = []
window.fetch = async (input, init) => {
  const name = new URL(String(input)).pathname.split('/').pop()
  const args = JSON.parse(init?.body || '{}')
  window.__boostCalls.push(name)
  if (
    name === 'confirm_commercial_order_with_terms' &&
    window.location.search.includes('expired=1') &&
    window.__boostCalls.filter((call) => call === name).length === 1
  ) {
    return new Response(JSON.stringify({ message: 'QUOTE_EXPIRED' }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    })
  }
  const payload =
    name === 'get_direct_post_boost_offer'
      ? {
          resourceId: null,
          expiresAt: null,
          tariff: { salesEnabled: true, price: '7', minDays: 1, maxDays: 30 },
        }
      : name === 'prepare_direct_post_boost'
        ? { resourceId: '7d500000-0000-0000-0000-000000000001' }
        : name === 'quote_commercial_order'
          ? {
              id: '7d600000-0000-0000-0000-000000000001',
              resourceId: '7d500000-0000-0000-0000-000000000001',
              durationDays: args.p_duration_days,
              unitPriceCash: '7',
              totalCash: String(7 * Number(args.p_duration_days)),
              createdAt: now.toISOString(),
              quoteExpiresAt: new Date(now.getTime() + 300000).toISOString(),
              terms: {
                documentId: 'advertising-terms',
                version: '1.0',
                digest: 'fixture',
                conditionsDigest: 'fixture',
                current: true,
              },
              refundPolicy: {},
            }
          : name === 'confirm_commercial_order_with_terms'
            ? {
                id: '7d600000-0000-0000-0000-000000000001',
                resourceId: '7d500000-0000-0000-0000-000000000001',
                status: 'fulfilled',
                periodEnd: later(3),
                durationDays: '3',
                totalCash: '21',
              }
            : {}
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}
createRoot(document.getElementById('root')).render(
  <ThemeProvider colorMode="day" dayScheme="light">
    <BaseStyles>
      <BrowserRouter>
        <WalletContext.Provider value={{ wallet: { cashBalance: 100 }, refresh: async () => {} }}>
          <PromoteDialog
            targetType="post"
            targetId="7d300000-0000-0000-0000-000000000001"
            onClose={() => {}}
          />
        </WalletContext.Provider>
      </BrowserRouter>
    </BaseStyles>
  </ThemeProvider>
)
