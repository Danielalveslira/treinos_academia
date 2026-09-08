export function IndicatorCard({ label, value }) {
  return (
    <div className="indicator-card">
      <span className="indicator-card__label">{label}</span>
      <span className="indicator-card__value">{value}</span>
    </div>
  )
}
