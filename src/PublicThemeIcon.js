import React from 'react'
import { MoonIcon, SunIcon } from '@primer/octicons-react'

export function PublicThemeIcon() {
  return React.createElement(
    React.Fragment,
    null,
    React.createElement(SunIcon, { className: 'public-theme-icon-sun', 'aria-hidden': true }),
    React.createElement(MoonIcon, { className: 'public-theme-icon-moon', 'aria-hidden': true })
  )
}
