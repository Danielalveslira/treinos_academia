import {
  PeopleIcon,
  MegaphoneIcon,
  PersonIcon,
  TrashIcon,
  ShieldLockIcon,
  BriefcaseIcon,
  CreditCardIcon,
  RocketIcon,
  ImageIcon,
} from '@primer/octicons-react'

// As 9 rotas administrativas reais (ver as rotas /admin/* em App.jsx, todas atrás de
// SuperAdminRoute) -- única fonte para o dropdown "Administração" de AccountMenu.jsx e
// para o AdminNav.jsx que cada página /admin/* renderiza no próprio cabeçalho. Vive num
// módulo .js puro (sem hooks/Supabase) de propósito: AdminNav é importado por todas as
// páginas /admin/*, e vários testes de página bundlam a página inteira via esbuild sem
// stub de useAuth/useColorMode -- puxar AccountMenu.jsx (que usa esses hooks) quebraria
// esses testes só para ler esta lista.
export const ADMIN_ITEMS = [
  { key: 'admin-comunidades', to: '/admin/comunidades', icon: PeopleIcon, label: 'Comunidades' },
  {
    key: 'admin-parcerias',
    to: '/admin/parcerias',
    icon: MegaphoneIcon,
    label: 'Anúncios e parcerias',
  },
  { key: 'admin-contas', to: '/admin/contas', icon: PersonIcon, label: 'Contas' },
  {
    key: 'admin-exclusao-contas',
    to: '/admin/exclusao-contas',
    icon: TrashIcon,
    label: 'Exclusão de contas',
  },
  { key: 'admin-moderacao', to: '/admin/moderacao', icon: ShieldLockIcon, label: 'Moderação' },
  { key: 'admin-vitrines', to: '/admin/vitrines', icon: BriefcaseIcon, label: 'Vitrines' },
  {
    key: 'admin-evocash',
    to: '/admin/compras-evocash',
    icon: CreditCardIcon,
    label: 'Compras de EvoCash',
  },
  {
    key: 'admin-promocoes',
    to: '/admin/promocoes',
    icon: RocketIcon,
    label: 'Promoções (EvoCash)',
  },
  {
    key: 'admin-imagens',
    to: '/admin/exercicios-imagens',
    icon: ImageIcon,
    label: 'Imagens dos exercícios',
  },
]
