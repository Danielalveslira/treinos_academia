export function EmptyState({ message, actionLabel, onAction }) {
  return (
    <div className="empty-state">
      <p>{message}</p>
      {actionLabel && onAction && (
        <button type="button" className="button button--primary" onClick={onAction}>
          {actionLabel}
        </button>
      )}
    </div>
  )
}
