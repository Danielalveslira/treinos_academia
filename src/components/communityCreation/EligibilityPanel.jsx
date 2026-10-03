import { Link as RouterLink } from 'react-router-dom'
import { Box, Button, Flash, ProgressBar, Text } from '@primer/react'
import { CheckCircleFillIcon, CircleIcon } from '@primer/octicons-react'
import { buildEligibilityChecklist, describeEligibilityGap } from '../../utils/communityCreation'

// Etapa 1 -- "Sua elegibilidade". Sempre visível, mesmo para quem ainda não é elegível: o
// usuário acompanha o progresso (dias de conta, dias ativos, limite) e vê exatamente o que
// falta. Só requisitos públicos; nada de regra antifraude. `eligible` aqui é UX -- quem
// autoriza a criação é create_community, que recalcula tudo no banco.
export function EligibilityPanel({ eligibility, onContinue }) {
  const checklist = buildEligibilityChecklist(eligibility)
  const gap = describeEligibilityGap(eligibility)

  return (
    <Box
      as="section"
      aria-labelledby="creation-eligibility-title"
      className="community-wizard-card"
    >
      <h2 id="creation-eligibility-title" className="community-wizard-title">
        Sua elegibilidade
      </h2>

      <ul className="community-eligibility-list">
        {checklist.map((item) => (
          <li key={item.key} className={`community-eligibility-item${item.done ? ' is-done' : ''}`}>
            <span className="community-eligibility-mark" aria-hidden="true">
              {item.done ? <CheckCircleFillIcon size={20} /> : <CircleIcon size={20} />}
            </span>
            <span className="community-eligibility-body">
              <span className="community-eligibility-label">
                {item.label}
                <span className="sr-only">{item.done ? ' (cumprido)' : ' (pendente)'}</span>
              </span>
              <span className="community-eligibility-detail">{item.detail}</span>
              {item.progress != null && !item.done && (
                <ProgressBar
                  barSize="small"
                  progress={Math.round(item.progress * 100)}
                  aria-label={`${item.label}: ${item.detail}`}
                />
              )}
            </span>
          </li>
        ))}
        <li className="community-eligibility-item is-info">
          <span className="community-eligibility-body">
            <span className="community-eligibility-label">EvoCoins disponíveis</span>
            <span className="community-eligibility-detail">{eligibility.evoCoinsBalance}</span>
          </span>
        </li>
      </ul>

      {eligibility.qualifiedToday && (
        <Text as="p" className="community-eligibility-today">
          Você usou o Evolutus o suficiente hoje.
        </Text>
      )}

      {gap.eligible ? (
        <Flash variant="success" sx={{ mb: 3 }}>
          Tudo certo! Você já pode criar uma comunidade.
        </Flash>
      ) : (
        <Flash variant={gap.restricted ? 'warning' : 'default'} sx={{ mb: 3 }} role="status">
          <Text as="p" sx={{ m: 0, fontWeight: 'bold' }}>
            {gap.restricted ? gap.message : 'Você ainda não pode criar uma comunidade.'}
          </Text>
          {!gap.restricted && (
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
      )}

      <Button variant="primary" block disabled={!gap.eligible} onClick={onContinue}>
        Continuar
      </Button>
    </Box>
  )
}
