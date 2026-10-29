import { BriefcaseIcon, PackageIcon } from '@primer/octicons-react'

// "Meu negócio": the three commercial routes grouped under one label, without renaming or
// merging them — /minha-vitrine (professional/establishment listing) and /vitrine/gerenciar
// (product storefronts) are different domains that share the word "vitrine" by coincidence,
// not by design; keeping them as separate entries avoids mixing the two. Previously
// /vitrine/gerenciar had no direct menu entry at all (only reachable via a button inside
// /minha-vitrine). Same pure-module reasoning as constants/adminNav.js: importable by
// AccountMenu.jsx and any test that bundles a page without stubbing useAuth/useColorMode.
export const BUSINESS_ITEMS = [
  { key: 'anuncios', to: '/meus-anuncios', icon: BriefcaseIcon, label: 'Meus anúncios' },
  {
    key: 'vitrine',
    to: '/minha-vitrine',
    icon: BriefcaseIcon,
    label: 'Minha vitrine profissional',
    show: (profile) => profile?.usageProfile !== 'common',
  },
  { key: 'vitrine-produtos', to: '/vitrine/gerenciar', icon: PackageIcon, label: 'Vitrine de produtos' },
]
