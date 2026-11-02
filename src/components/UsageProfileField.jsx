import { USAGE_PROFILE_OPTIONS } from '../constants/usageProfile'

// Reaproveitado no cadastro (obrigatório, sem pré-seleção), em Meu Perfil (troca
// posterior, valor atual pré-selecionado) e no preenchimento contextual de conta
// legada dentro do fluxo da Vitrine -- um único lugar decide a lista/rótulos das três
// opções, evitando divergência entre as telas e entre desktop/mobile.
export function UsageProfileField({
  value,
  onChange,
  name = 'usageProfile',
  legend = 'Como você pretende utilizar o Evolutus?',
  disabled = false,
  // Cadastro: rótulos curtos e opções compactas. Os VALORES são sempre os de USAGE_PROFILE_OPTIONS.
  options = USAGE_PROFILE_OPTIONS,
  compact = false,
  invalid = false,
}) {
  return (
    <fieldset
      className={
        compact ? 'usage-profile-field usage-profile-field--compact' : 'usage-profile-field'
      }
      disabled={disabled}
      aria-invalid={invalid ? true : undefined}
    >
      <legend>{legend}</legend>
      {options.map((option) => (
        <label key={option.value} className="usage-profile-option">
          <input
            type="radio"
            name={name}
            value={option.value}
            checked={value === option.value}
            onChange={() => onChange(option.value)}
          />
          <span>
            <strong>{option.label}</strong>
            <small>{option.description}</small>
          </span>
        </label>
      ))}
    </fieldset>
  )
}
