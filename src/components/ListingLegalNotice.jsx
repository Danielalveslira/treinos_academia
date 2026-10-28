import { useEffect, useState } from 'react'
import { Box, Button, Flash } from '@primer/react'
import { ShowcaseTermsUpdateDialog } from './ShowcaseTermsUpdateDialog'
import {
  getActiveShowcasePolicy,
  getShowcaseLegalAcknowledgement,
  getShowcaseLegalVersion,
  acknowledgeShowcaseTerms,
} from '../services/professionalListingsService'
import { shouldShowShowcaseTermsBanner } from '../utils/showcaseLegal'
export default function ListingLegalNotice({ userId }) {
  const [policy, setPolicy] = useState(null),
    [ack, setAck] = useState(null),
    [open, setOpen] = useState(false),
    [changes, setChanges] = useState(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('')
  useEffect(() => {
    let active = true
    getActiveShowcasePolicy()
      .then(async (p) => {
        const a =
          p?.published && p.version
            ? await getShowcaseLegalAcknowledgement(userId, p.version)
            : null
        if (active) {
          setPolicy(p)
          setAck(a)
        }
      })
      .catch(() => {})
    return () => {
      active = false
    }
  }, [userId])
  async function acknowledge() {
    setBusy(true)
    try {
      await acknowledgeShowcaseTerms()
      setAck(await getShowcaseLegalAcknowledgement(userId, policy.version))
      setOpen(false)
    } catch {
      setError('Não foi possível registrar sua ciência. Você pode continuar editando.')
    } finally {
      setBusy(false)
    }
  }
  async function show() {
    setOpen(true)
    setBusy(true)
    try {
      const v = await getShowcaseLegalVersion(policy.version)
      setChanges(v?.manifest?.changes || [])
    } catch {
      setError('Não foi possível carregar as alterações.')
    } finally {
      setBusy(false)
    }
  }
  return (
    <>
      {shouldShowShowcaseTermsBanner({ policy, acknowledgement: ack }) && (
        <Flash>
          <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
            Termos da Vitrine atualizados.<Button onClick={show}>Ler alterações</Button>
            <Button onClick={acknowledge} disabled={busy}>
              Entendi
            </Button>
          </Box>
        </Flash>
      )}
      {error && <Flash variant="warning">{error}</Flash>}
      {open && (
        <ShowcaseTermsUpdateDialog
          version={policy?.version}
          changes={changes}
          loading={busy}
          onClose={() => setOpen(false)}
          onAcknowledge={acknowledge}
          acknowledging={busy}
        />
      )}
    </>
  )
}
