import { COMMUNITY_ICON_NAMES, getCommunityIcon } from '../constants/communityIcons'
import { CommunityIcon } from './CommunityIcon'

// Grade fixa (nunca upload livre -- COMMUNITY_ICON_NAMES é a lista fechada de nomes
// aceitos) com preview no mesmo badge usado na listagem, pra quem está criando ver
// exatamente como vai aparecer antes de salvar.
export function CommunityIconPicker({ value, onChange, name }) {
  return (
    <div className="community-icon-picker">
      <div className="community-icon-picker-preview">
        <CommunityIcon community={{ iconName: value }} size={48} />
        <span>{name?.trim() || 'Pré-visualização'}</span>
      </div>
      <div className="community-icon-grid" role="radiogroup" aria-label="Ícone da comunidade">
        {COMMUNITY_ICON_NAMES.map((iconName) => {
          const Icon = getCommunityIcon(iconName)
          const selected = value === iconName
          return (
            <button
              key={iconName}
              type="button"
              role="radio"
              aria-checked={selected}
              aria-label={iconName}
              className={`community-icon-option${selected ? ' is-selected' : ''}`}
              onClick={() => onChange(iconName)}
            >
              <Icon size={20} strokeWidth={2} />
            </button>
          )
        })}
      </div>
    </div>
  )
}
