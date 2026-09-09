export function IndicatorCard({ label, value, icon: Icon }) {
  return (
    <div className="indicator-card">
      <div className="indicator-label">
        {Icon && <Icon size={16} />}
        <span>{label}</span>
      </div>
      <div className="indicator-value">
        {typeof value === 'number' ? value.toLocaleString('pt-BR') : value}
      </div>
    </div>
  )
}
