import { createRequire } from 'node:module'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import styledComponents from 'styled-components'
import { ThreeBarsIcon } from '@primer/octicons-react'
import { PublicThemeIcon } from '../src/PublicThemeIcon.js'

// Primer 37's CommonJS build imports CSS modules. The app build emits their CSS;
// these server-only imports only need the deterministic class names.
const require = createRequire(import.meta.url)
const previousCssLoader = require.extensions['.css']
require.extensions['.css'] = () => {}
const { Box, Button, Heading, IconButton, Label, Link, Text } = require('@primer/react')
if (previousCssLoader) require.extensions['.css'] = previousCssLoader
else delete require.extensions['.css']

const sheet = new styledComponents.ServerStyleSheet()
const h = React.createElement
let fragmentId = 0
const markup = (component) => renderToStaticMarkup(sheet.collectStyles(component), { identifierPrefix: `pp${fragmentId++}-` })
const trusted = (content) => h('span', { dangerouslySetInnerHTML: { __html: content } })

export const primerStyles = () => sheet.getStyleTags()
export const primerBox = (tag, className, children, props = {}) => markup(h(Box, { as: tag, className, ...props, dangerouslySetInnerHTML: { __html: children } }))
export const primerHeading = (tag, className, children) => markup(h(Heading, { as: tag, className }, children))
export const primerText = (tag, className, children) => markup(h(Text, { as: tag, className }, children))
export const primerLabel = (children, className = '') => markup(h(Label, { className }, children))
export const primerPrimaryLink = (href, label, className = '') =>
  markup(h(Button, { as: 'a', href, variant: 'primary', className }, label))
export const primerHeaderLink = (href, label, variant, className) =>
  markup(h(Button, { as: 'a', href, variant, className }, label))
export const primerThemeTrigger = () => markup(h(IconButton, {
  icon: PublicThemeIcon,
  'aria-label': 'Alternar tema',
  variant: 'invisible',
  className: 'public-theme-trigger',
  unsafeDisableTooltip: true,
}))
export const primerMenuTrigger = () => markup(h(IconButton, {
  icon: ThreeBarsIcon,
  'aria-label': 'Menu de navegação',
  'aria-expanded': false,
  'aria-haspopup': true,
  variant: 'invisible',
  className: 'public-header-trigger',
  unsafeDisableTooltip: true,
}))
export const primerLink = (href, label, kind = '') => {
  const content = trusted(label)
  return kind.includes('button')
    ? markup(h(Button, { as: 'a', href, className: kind }, content))
    : markup(h(Link, { href, className: kind }, content))
}
