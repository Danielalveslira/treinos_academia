import { Box, Heading, Spinner } from '@primer/react'
import { SubscriptionPanel } from '../components/SubscriptionPanel'
import { useAuth } from '../hooks/useAuth'
import { useBillingConfig } from '../hooks/useBillingConfig'
import { getUserAccessState } from '../utils/billing'

export default function Payment() {
  const { user, profile } = useAuth()
  const { config, loading } = useBillingConfig()
  const accessState = getUserAccessState(profile)

  return (
    <Box>
      <Heading as="h1" sx={{ fontSize: 3, mb: 3 }}>
        Assinatura
      </Heading>
      {loading ? (
        <Spinner sx={{ display: 'block', mx: 'auto', my: 5 }} />
      ) : (
        <SubscriptionPanel
          profile={profile}
          email={user?.email}
          accessState={accessState}
          billingConfig={config}
        />
      )}
    </Box>
  )
}
