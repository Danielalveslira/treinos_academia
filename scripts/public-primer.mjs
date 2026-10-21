import { createRequire } from 'node:module'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import styledComponents from 'styled-components'

// Primer 37's CommonJS build imports CSS modules. The app build emits their CSS;
// these server-only imports only need the deterministic class names.
const require = createRequire(import.meta.url)
const previousCssLoader = require.extensions['.css']
require.extensions['.css'] = () => {}
const {
  ActionList, Box, Button, FormControl, Heading, Label, Link, Select, Text, Textarea,
  TextInput,
} = require('@primer/react')
const {
  CalendarIcon, SearchIcon, ChecklistIcon, HistoryIcon, GraphIcon, PeopleIcon, ChevronDownIcon,
} = require('@primer/octicons-react')
if (previousCssLoader) require.extensions['.css'] = previousCssLoader
else delete require.extensions['.css']

const sheet = new styledComponents.ServerStyleSheet()
const h = React.createElement
let fragmentId = 0
const markup = (component) => renderToStaticMarkup(sheet.collectStyles(component), { identifierPrefix: `pp${fragmentId++}-` })
const trusted = (content) => h('span', { dangerouslySetInnerHTML: { __html: content } })

export const primerStyles = () => sheet.getStyleTags()
export const primerBox = (tag, className, children) => markup(h(Box, { as: tag, className, dangerouslySetInnerHTML: { __html: children } }))
export const primerHeading = (tag, className, children) => markup(h(Heading, { as: tag, className }, children))
export const primerText = (tag, className, children) => markup(h(Text, { as: tag, className }, children))
export const primerLabel = (children, className = '') => markup(h(Label, { className }, children))
const featureIcons = { '▦': CalendarIcon, '⊞': SearchIcon, '≡': ChecklistIcon, '◷': HistoryIcon, '↗': GraphIcon, '◎': PeopleIcon }
export const primerFeatureIcon = (symbol) => markup(h(featureIcons[symbol], { size: 24, 'aria-hidden': true }))
export const primerLink = (href, label, kind = '') => {
  const content = trusted(label)
  return kind.includes('button')
    ? markup(h(Button, { as: 'a', href, className: kind }, content))
    : markup(h(Link, { href, className: kind }, content))
}
export const primerButton = (id, label, className = '', props = {}) => markup(h(Button, {
  id, type: 'button', className, ...props,
}, label))

// The public pages remain static. Primer supplies the trigger and list markup;
// a few lines of browser JS manage this one disclosure without React hydration.
export const primerExploreButton = () => markup(h(Button, {
  type: 'button', id: 'public-menu-trigger', className: 'public-menu-trigger',
  'aria-controls': 'public-menu-panel', 'aria-expanded': 'false',
  trailingVisual: ChevronDownIcon,
}, 'Explorar'))
export const primerNavigationList = (groups) => markup(h(ActionList, {
  className: 'public-action-list', disableFocusZone: true,
}, ...groups.map(({ title, links }) => h(ActionList.Group, { key: title },
  h(ActionList.GroupHeading, { as: 'h2' }, title),
  ...links.map(([href, label, primary]) => h(ActionList.LinkItem, {
    key: href, href, className: primary ? 'public-menu-primary' : undefined,
  }, label))
))))

export const primerInput = (name, label, props = {}) => markup(
  h(FormControl, { required: Boolean(props.required), id: props.id, className: 'primer-field' },
    h(FormControl.Label, null, label),
    h(TextInput, { name, ...Object.fromEntries(Object.entries(props).filter(([key]) => key !== 'required' && key !== 'id')) })
  )
).replace('aria-required="true"', 'required="" aria-required="true"')
export const primerSelect = (name, label, options, props = {}) => markup(
  h(FormControl, { required: Boolean(props.required), id: props.id, className: 'primer-field' },
    h(FormControl.Label, null, label),
    h(Select, { name, ...Object.fromEntries(Object.entries(props).filter(([key]) => key !== 'required' && key !== 'id')) }, ...options.map(([value, text]) => h('option', { key: value, value }, text)))
  )
).replace('aria-required="true"', 'required="" aria-required="true"')
export const primerTextarea = (name, label, props = {}) => markup(
  h(FormControl, { required: Boolean(props.required), className: 'primer-field' },
    h(FormControl.Label, null, label),
    h(Textarea, { name, ...Object.fromEntries(Object.entries(props).filter(([key]) => key !== 'required')) })
  )
).replace('aria-required="true"', 'required="" aria-required="true"')
