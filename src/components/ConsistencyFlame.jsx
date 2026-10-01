export function ConsistencyFlame({ active = false }) {
  return (
    <svg
      className={`consistency-flame${active ? ' is-active' : ''}`}
      viewBox="0 0 32 40"
      role="img"
      aria-label={active ? 'Consistência ativa hoje' : 'Indicador de consistência'}
    >
      <path
        className="consistency-flame-outer"
        d="M18.4 2.7c1.2 6.3-2.6 8.6-2.6 13.1-2.2-2.4-2.9-4.8-2.4-7.4C7.8 12.5 4.8 17.2 4.8 23c0 8 5 14.3 11.4 14.3S27.4 31.4 27.4 24c0-8.6-5.3-15.9-9-21.3Z"
      />
      <path
        className="consistency-flame-inner"
        d="M16.7 19.2c.4 3-2.2 4.3-2.2 7.2-1.2-1.1-1.7-2.3-1.6-3.6-2.1 2-3.1 4-3.1 6.4 0 4.4 2.9 7.7 6.5 7.7s6.4-3.1 6.4-7.4c0-4.7-3.1-8.3-6-10.3Z"
      />
    </svg>
  )
}
