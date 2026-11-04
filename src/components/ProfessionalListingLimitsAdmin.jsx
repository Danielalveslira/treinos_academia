import { useEffect, useRef, useState } from 'react'
import {
  Box,
  Button,
  Checkbox,
  Flash,
  FormControl,
  Select,
  Text,
  TextInput,
  Textarea,
} from '@primer/react'
import {
  getProfessionalListingLimits,
  setProfessionalListingLimit,
} from '../services/professionalListingsService'
import { reauthenticatePricingAdmin } from '../services/evocashPricingService'
import { AuthCaptcha } from './AuthCaptcha'
import { authCaptchaRequired, takeCaptchaToken } from '../utils/authCaptcha'
import { storefrontError } from '../utils/storefront'
export default function ProfessionalListingLimitsAdmin() {
  const [rows, setRows] = useState(null),
    [kind, setKind] = useState('professional'),
    [max, setMax] = useState(''),
    [unlimited, setUnlimited] = useState(false),
    [reason, setReason] = useState(''),
    [password, setPassword] = useState(''),
    [confirm, setConfirm] = useState(false),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(''),
    [error, setError] = useState('')
  const lock = useRef(false)
  const captcha = useRef(null)
  const [captchaVerified, setCaptchaVerified] = useState(!authCaptchaRequired)
  useEffect(() => {
    let active = true
    getProfessionalListingLimits()
      .then((r) => active && setRows(r))
      .catch((e) => active && setError(storefrontError(e)))
    return () => {
      active = false
    }
  }, [])
  const row = rows?.find((r) => r.kind === kind)
  async function save(e) {
    e.preventDefault()
    if (lock.current) return
    lock.current = true
    setBusy(true)
    setError('')
    setMessage('')
    try {
      await reauthenticatePricingAdmin(password, takeCaptchaToken(captcha))
      await setProfessionalListingLimit(
        kind,
        unlimited ? null : Number(max),
        row?.revision || '0',
        reason
      )
      setRows(await getProfessionalListingLimits())
      setPassword('')
      setConfirm(false)
      setMessage('Limite registrado. Contratos existentes foram preservados.')
    } catch (e) {
      setError(storefrontError(e))
      getProfessionalListingLimits()
        .then(setRows)
        .catch(() => {})
    } finally {
      captcha.current?.reset()
      setBusy(false)
      lock.current = false
    }
  }
  return (
    <Box as="form" onSubmit={save} sx={{ display: 'grid', gap: 3, my: 3 }}>
      <Text as="p">
        Ausência de configuração bloqueia novas criações. Zero pausa criações; não afeta recursos
        existentes. Sem limite é uma decisão administrativa explícita.
      </Text>
      {error && <Flash variant="danger">{error}</Flash>}
      {message && <Flash variant="success">{message}</Flash>}
      <FormControl disabled={busy}>
        <FormControl.Label>Tipo para configurar</FormControl.Label>
        <Select
          value={kind}
          onChange={(e) => {
            setKind(e.target.value)
            setConfirm(false)
            setMax('')
            setUnlimited(false)
          }}
        >
          <Select.Option value="professional">Profissional</Select.Option>
          <Select.Option value="space">Estabelecimento</Select.Option>
        </Select>
      </FormControl>
      <Text as="p">
        Atual:{' '}
        {row ? (row.maxPerOwner === null ? 'sem limite' : row.maxPerOwner) : 'não configurado'}
      </Text>
      <FormControl disabled={busy || unlimited}>
        <FormControl.Label>Máximo por proprietário</FormControl.Label>
        <TextInput
          block
          inputMode="numeric"
          value={max}
          onChange={(e) => {
            setMax(e.target.value)
            setConfirm(false)
          }}
        />
      </FormControl>
      <FormControl disabled={busy}>
        <Checkbox
          checked={unlimited}
          onChange={(e) => {
            setUnlimited(e.target.checked)
            setConfirm(false)
          }}
        />
        <FormControl.Label>Permitir sem limite de quantidade</FormControl.Label>
      </FormControl>
      <FormControl disabled={busy}>
        <FormControl.Label>Justificativa do limite</FormControl.Label>
        <Textarea
          block
          value={reason}
          onChange={(e) => {
            setReason(e.target.value)
            setConfirm(false)
          }}
          maxLength={500}
        />
      </FormControl>
      <FormControl disabled={busy}>
        <FormControl.Label>Senha para configurar limite</FormControl.Label>
        <TextInput
          block
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </FormControl>
      <AuthCaptcha ref={captcha} onVerifiedChange={setCaptchaVerified} />
      <FormControl disabled={busy}>
        <Checkbox checked={confirm} onChange={(e) => setConfirm(e.target.checked)} />
        <FormControl.Label>Confirmo esta configuração auditada</FormControl.Label>
      </FormControl>
      <Button
        type="submit"
        disabled={
          !rows ||
          busy ||
          !confirm ||
          !password ||
          !captchaVerified ||
          reason.trim().length < 5 ||
          (!unlimited && (!/^(0|[1-9][0-9]{0,9})$/.test(max) || Number(max) > 2147483647))
        }
      >
        Salvar limite de cadastros
      </Button>
    </Box>
  )
}
