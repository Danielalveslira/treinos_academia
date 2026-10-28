import { useEffect, useRef, useState } from 'react'
import { Box, Button, Checkbox, Flash, FormControl, Text } from '@primer/react'
import {
  configureCommunityAdvertising,
  getCommunityAdvertisingPermissions,
} from '../services/advertisingService'
export default function CommunityAdvertisingPermissions({ communityId }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const lock = useRef(false)
  useEffect(() => {
    let live = true
    getCommunityAdvertisingPermissions(communityId)
      .then((r) => {
        if (live)
          setData({
            revision: r.revision,
            posts: r.post_boosts_enabled,
            community: r.community_boosts_enabled,
          })
      })
      .catch((e) => {
        if (live) setError(e.message)
      })
    return () => {
      live = false
    }
  }, [communityId])
  async function save() {
    if (lock.current) return
    lock.current = true
    setBusy(true)
    setError('')
    try {
      const result = await configureCommunityAdvertising(communityId, data)
      setData({
        revision: result.revision,
        posts: result.post_boosts_enabled,
        community: result.community_boosts_enabled,
      })
    } catch (e) {
      setError(e.message)
    } finally {
      lock.current = false
      setBusy(false)
    }
  }
  return (
    <Box sx={{ mt: 3 }}>
      <Text as="h3" sx={{ fontSize: 2 }}>
        Permissões de impulsionamento desta comunidade
      </Text>
      {error && <Flash variant="danger">{error}</Flash>}
      {data && (
        <>
          <FormControl disabled={busy}>
            <Checkbox
              checked={data.posts}
              onChange={(e) => setData({ ...data, posts: e.target.checked })}
            />
            <FormControl.Label>Permitir destaque de publicações autorizadas</FormControl.Label>
          </FormControl>
          <FormControl disabled={busy}>
            <Checkbox
              checked={data.community}
              onChange={(e) => setData({ ...data, community: e.target.checked })}
            />
            <FormControl.Label>Permitir destaque desta comunidade</FormControl.Label>
          </FormControl>
          <Button disabled={busy} onClick={save}>
            Salvar permissões
          </Button>
        </>
      )}
    </Box>
  )
}
