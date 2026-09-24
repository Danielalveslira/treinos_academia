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
}) {
  return (
    <fieldset className="usage-profile-field" disabled={disabled}>
      <legend>{legend}</legend>
      {USAGE_PROFILE_OPTIONS.map((option) => (
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
