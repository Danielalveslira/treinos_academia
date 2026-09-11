import { Link } from 'react-router-dom'
import { Box, Button, Heading, Text } from '@primer/react'
import { PublicLayout } from '../components/PublicLayout'

export default function NotFound() {
  return (
    <PublicLayout>
      <Box
        sx={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          textAlign: 'center',
          gap: 3,
          py: 6,
        }}
      >
        <Heading as="h1" sx={{ fontSize: 3 }}>
          Página não encontrada
        </Heading>
        <Text sx={{ color: 'fg.muted' }}>O endereço acessado não existe ou foi movido.</Text>
        <Button as={Link} to="/" replace variant="primary">
          Voltar ao início
        </Button>
      </Box>
    </PublicLayout>
  )
}
