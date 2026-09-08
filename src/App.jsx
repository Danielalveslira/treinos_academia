import { lazy, Suspense } from 'react'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { Box, Spinner } from '@primer/react'
import { AuthProvider } from './contexts/AuthContext'
import { ProtectedRoute } from './components/ProtectedRoute'
import { Layout } from './components/Layout'

const Login = lazy(() => import('./pages/Login'))
const Register = lazy(() => import('./pages/Register'))
const ForgotPassword = lazy(() => import('./pages/ForgotPassword'))
const Dashboard = lazy(() => import('./pages/Dashboard'))
const Exercises = lazy(() => import('./pages/Exercises'))
const ExerciseDetail = lazy(() => import('./pages/ExerciseDetail'))
const NewWorkout = lazy(() => import('./pages/NewWorkout'))
const History = lazy(() => import('./pages/History'))
const Pricing = lazy(() => import('./pages/Pricing'))

function PageFallback() {
  return (
    <Box
      sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '50vh' }}
    >
      <Spinner />
    </Box>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Suspense fallback={<PageFallback />}>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/cadastro" element={<Register />} />
            <Route path="/esqueci-senha" element={<ForgotPassword />} />
            <Route path="/planos" element={<Pricing />} />

            <Route
              element={
                <ProtectedRoute>
                  <Layout />
                </ProtectedRoute>
              }
            >
              <Route path="/" element={<Dashboard />} />
              <Route path="/exercicios" element={<Exercises />} />
              <Route path="/exercicios/:id" element={<ExerciseDetail />} />
              <Route path="/novo-treino" element={<NewWorkout />} />
              <Route path="/historico" element={<History />} />
            </Route>
          </Routes>
        </Suspense>
      </AuthProvider>
    </BrowserRouter>
  )
}
