export function BrandMark({ size = 28, className = '' }) {
  return (
    <svg
      className={`brand-bars ${className}`.trim()}
      width={size}
      height={size}
      viewBox="0 0 28 28"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <rect className="brand-bar brand-bar-one" x="3" y="15" width="5" height="10" rx="1.5" />
      <rect className="brand-bar brand-bar-two" x="11.5" y="10" width="5" height="15" rx="1.5" />
      <rect className="brand-bar brand-bar-three" x="20" y="3" width="5" height="22" rx="1.5" />
    </svg>
  )
}
