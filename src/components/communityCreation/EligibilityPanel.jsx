import { Link as RouterLink } from 'react-router-dom'
import { Box, Flash, Text } from '@primer/react'
import { CircleIcon } from '@primer/octicons-react'
import { buildEligibilityChecklist, describeEligibilityGap } from '../../utils/communityCreation'

// Aviso de elegibilidade -- inline, dentro da etapa "Informações", sem etapa própria. Mostra
// só o que falta (dias de conta/dias ativos não são mais requisito -- ver
// eligibility_simplify). `eligible` aqui é só UX: quem autoriza a criação é sempre o servidor
// (create_community/create_free_community recalculam tudo). Restrição/moderação nunca detalha
// o motivo -- `gap.restricted` já vem como mensagem genérica.
export function EligibilityPanel({ eligibility }) {
  const gap = describeEligibilityGap(eligibility)

  if (gap.eligible) {
    return (
      <Flash variant="success" sx={{ mb: 3 }}>
        Tudo certo! Você já pode criar uma comunidade.
      </Flash>
    )
  }

  const pending = buildEligibilityChecklist(eligibility).filter((item) => !item.done)

  return (
    <Box sx={{ mb: 3 }}>
      {pending.length > 0 && (
        <ul className="community-eligibility-list">
          {pending.map((item) => (
            <li key={item.key} className="community-eligibility-item">
              <span className="community-eligibility-mark" aria-hidden="true">
                <CircleIcon size={20} />
              </span>
              <span className="community-eligibility-body">
                <span className="community-eligibility-label">{item.label}</span>
                <span className="community-eligibility-detail">{item.detail}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
      <Flash variant={gap.restricted ? 'warning' : 'default'} role="status">
        <Text as="p" sx={{ m: 0, fontWeight: 'bold' }}>
          {gap.restricted ? gap.message : 'Você ainda não pode criar uma comunidade.'}
        </Text>
        {!gap.restricted && gap.message !== 'Você ainda não pode criar uma comunidade.' && (
          <Text as="p" sx={{ m: 0, mt: 1 }}>
            {gap.message}
          </Text>
        )}
        {gap.restricted && (
          <Text as="p" sx={{ m: 0, mt: 1 }}>
            <RouterLink to="/atendimento">Falar com o atendimento</RouterLink>
          </Text>
        )}
      </Flash>
    </Box>
  )
}
