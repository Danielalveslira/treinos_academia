import { Checkbox, Flash, FormControl, Text } from '@primer/react'
import { Link } from 'react-router-dom'
import {
  commercialDocumentLink,
  commercialTermsLabel,
  commercialTermsState,
} from '../utils/commercialTerms'

// Resumo das condições congeladas na cotação + aceite explícito da versão exata do
// documento comercial. A caixa nunca vem marcada e é desmarcada a cada nova cotação
// (o componente pai controla `checked`). O servidor recusa qualquer divergência.
export function CommercialTermsAcceptance({ terms, summary, checked, onChange, disabled }) {
  const state = commercialTermsState(terms)
  if (state === 'unavailable') {
    return (
      <Flash variant="attention">
        Os termos desta contratação ainda não foram publicados. A contratação permanece indisponível
        e nada será cobrado.
      </Flash>
    )
  }
  if (state === 'changed') {
    return (
      <Flash variant="attention">
        Os termos mudaram depois desta cotação. Gere uma nova cotação para revisar a versão vigente.
        Nada foi cobrado.
      </Flash>
    )
  }
  const label = commercialTermsLabel(terms)
  const link = commercialDocumentLink(terms.documentId, terms.version)
  return (
    <div className="commercial-terms-box">
      <Text as="p" sx={{ m: 0, fontWeight: 'bold' }}>
        Resumo do que você está contratando
      </Text>
      <dl>
        {summary.map(([term, value]) => (
          <div key={term}>
            <dt>{term}</dt>
            <dd>{value}</dd>
          </div>
        ))}
        <dt>Documento</dt>
        <dd>
          {link ? (
            <Link to={link} target="_blank" rel="noopener">
              {label}
            </Link>
          ) : (
            label
          )}{' '}
          · versão {terms.version}
        </dd>
      </dl>
      <FormControl disabled={disabled}>
        <Checkbox checked={checked} onChange={(e) => onChange(e.target.checked)} />
        <FormControl.Label>
          Li e aceito {label} (versão {terms.version}) e confirmo as condições acima.
        </FormControl.Label>
      </FormControl>
    </div>
  )
}
