import { NavLink, Outlet } from 'react-router-dom'
import { Header, Box, Text } from '@primer/react'
import { HomeIcon, PlusCircleIcon, HistoryIcon, ListUnorderedIcon, SignOutIcon } from '@primer/octicons-react'
import { logoutUser } from '../services/authService'

const NAV_ITEMS = [
  { to: '/', label: 'Início', icon: HomeIcon, end: true },
  { to: '/novo-treino', label: 'Registrar', icon: PlusCircleIcon },
  { to: '/historico', label: 'Histórico', icon: HistoryIcon },
  { to: '/exercicios', label: 'Exercícios', icon: ListUnorderedIcon },
]

const headerLinkStyle = ({ isActive }) => ({
  color: isActive ? '#ffffff' : 'rgba(255, 255, 255, 0.7)',
  fontWeight: isActive ? 600 : 400,
  textDecoration: 'none',
  fontSize: '14px',
})

const bottomNavLinkStyle = ({ isActive }) => ({
  flex: 1,
  textDecoration: 'none',
  color: isActive ? 'var(--fgColor-accent)' : 'var(--fgColor-muted)',
})

export function Layout() {
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
      <Header sx={{ position: 'sticky', top: 0, zIndex: 10, py: 2 }}>
        <Header.Item>
          <Text sx={{ fontSize: 2, fontWeight: 'bold', color: 'inherit' }}>Treinos</Text>
        </Header.Item>
        <Header.Item full>
          <Box sx={{ display: ['none', 'none', 'flex'], gap: 4 }}>
            {NAV_ITEMS.map((item) => (
              <NavLink key={item.to} to={item.to} end={item.end} style={headerLinkStyle}>
                {item.label}
              </NavLink>
            ))}
          </Box>
        </Header.Item>
        <Header.Item>
          <Header.Link as="button" onClick={logoutUser} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <SignOutIcon />
            Sair
          </Header.Link>
        </Header.Item>
      </Header>

      <Box
        as="main"
        sx={{
          flex: 1,
          width: '100%',
          maxWidth: '640px',
          mx: 'auto',
          px: 3,
          py: 3,
          pb: ['88px', '88px', 3],
        }}
      >
        <Outlet />
      </Box>

      <Box
        as="nav"
        sx={{
          display: ['flex', 'flex', 'none'],
          position: 'fixed',
          bottom: 0,
          left: 0,
          right: 0,
          bg: 'canvas.default',
          borderTop: '1px solid',
          borderColor: 'border.default',
          pb: 'env(safe-area-inset-bottom)',
          zIndex: 10,
        }}
      >
        {NAV_ITEMS.map((item) => (
          <NavLink key={item.to} to={item.to} end={item.end} style={bottomNavLinkStyle}>
            <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2px', py: 2 }}>
              <item.icon size={20} />
              <Text sx={{ fontSize: 0, display: 'block' }}>{item.label}</Text>
            </Box>
          </NavLink>
        ))}
      </Box>
    </Box>
  )
}
