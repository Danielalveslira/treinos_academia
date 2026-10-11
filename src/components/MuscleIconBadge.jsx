// Generaliza o badge de ícone já usado em WorkoutForm.jsx (.muscle-group-mark) pras
// outras telas que mostram grupo/músculo (Exercises.jsx, ExerciseCatalog.jsx,
// ExerciseDetail.jsx, WorkoutExerciseGuide.jsx, Progress.jsx) -- mesmo visual "premium"
// (ícone colorido num fundo neutro arredondado), só centralizado num componente em vez de
// repetir o mesmo <span><Icon/></span> em cada lugar.
export function MuscleIconBadge({ icon, size = 'md', tone = 'solid', className = '' }) {
  const Icon = icon
  const classes = ['muscle-icon-badge', `muscle-icon-badge--${size}`, `muscle-icon-badge--${tone}`, className]
    .filter(Boolean)
    .join(' ')
  return (
    <span className={classes} aria-hidden="true">
      <Icon size={size === 'sm' ? 14 : 20} strokeWidth={2} />
    </span>
  )
}
