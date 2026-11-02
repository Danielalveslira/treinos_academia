const SIGNUP_STEPS = ['Sua conta', 'Sobre você', 'Finalizar']

// Indicador compacto do cadastro: texto ("2 de 3") + três segmentos. Só informativo -- não é
// navegável, para nunca permitir pular a validação de uma etapa. Etapa atual marcada com
// aria-current; concluídas/atual/pendentes também diferem por texto e preenchimento, não só cor.
export function SignupProgress({ current }) {
  const total = SIGNUP_STEPS.length
  return (
    <div className="signup-progress">
      <p className="signup-progress-head">
        <span>Criar conta</span>
        <span aria-hidden="true">
          {current} de {total}
        </span>
        <span className="sr-only">
          Etapa {current} de {total}: {SIGNUP_STEPS[current - 1]}
        </span>
      </p>
      <ol className="signup-progress-steps" aria-label="Etapas do cadastro">
        {SIGNUP_STEPS.map((label, index) => {
          const step = index + 1
          const state = step < current ? 'done' : step === current ? 'current' : 'todo'
          return (
            <li
              key={label}
              className={`signup-progress-step is-${state}`}
              aria-current={state === 'current' ? 'step' : undefined}
            >
              <span className="signup-progress-bar" aria-hidden="true" />
              <span className="signup-progress-label">
                {label}
                <span className="sr-only">
                  {state === 'done'
                    ? ' (concluída)'
                    : state === 'todo'
                      ? ' (pendente)'
                      : ' (atual)'}
                </span>
              </span>
            </li>
          )
        })}
      </ol>
    </div>
  )
}
