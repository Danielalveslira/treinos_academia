export function FormField({ label, error, children }) {
  return (
    <label className="form-field">
      <span className="form-field__label">{label}</span>
      {children}
      {error && <span className="form-field__error">{error}</span>}
    </label>
  )
}
