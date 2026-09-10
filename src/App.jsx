import { lazy, Suspense } from 'react'
import { BrowserRouter, Routes, Route, Outlet } from 'react-router-dom'
import { AuthProvider } from './contexts/AuthContext'
import { ExercisesProvider } from './contexts/ExercisesContext'
import { ProtectedRoute } from './components/ProtectedRoute'
import { SuperAdminRoute } from './components/SuperAdminRoute'
import { Layout } from './components/Layout'
import { PageFallback } from './components/PageFallback'
import { routeLoaders } from './routeLoaders'

const Login = lazy(() => import('./pages/Login'))
const Register = lazy(() => import('./pages/Register'))
const ForgotPassword = lazy(() => import('./pages/ForgotPassword'))
const Dashboard = lazy(routeLoaders['/'])
const Exercises = lazy(routeLoaders['/exercicios'])
const ExerciseDetail = lazy(() => import('./pages/ExerciseDetail'))
const NewWorkout = lazy(routeLoaders['/novo-treino'])
const History = lazy(routeLoaders['/historico'])
const Communities = lazy(routeLoaders['/comunidades'])
const CommunityDetail = lazy(() => import('./pages/CommunityDetail'))
const AdminCommunities = lazy(() => import('./pages/AdminCommunities'))
const PublicProfile = lazy(() => import('./pages/PublicProfile'))
const Profile = lazy(() => import('./pages/Profile'))
const LegalDocument = lazy(() => import('./pages/LegalDocument'))
const Support = lazy(() => import('./pages/Support'))
const AdminModeration = lazy(() => import('./pages/AdminModeration'))
const AdminAccounts = lazy(() => import('./pages/AdminAccounts'))
const NotFound = lazy(() => import('./pages/NotFound'))

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route
            element={
              <Suspense fallback={<PageFallback />}>
                <Outlet />
              </Suspense>
            }
          >
            <Route path="/login" element={<Login />} />
            <Route path="/cadastro" element={<Register />} />
            <Route path="/esqueci-senha" element={<ForgotPassword />} />
            <Route
              path="/regras-da-comunidade"
              element={<LegalDocument documentId="community" />}
            />
            <Route path="/termos-de-uso" element={<LegalDocument documentId="terms" />} />
            <Route
              path="/politica-de-privacidade"
              element={<LegalDocument documentId="privacy" />}
            />
            <Route path="/atendimento" element={<Support />} />
            <Route path="*" element={<NotFound />} />
          </Route>

          <Route
            element={
              <ProtectedRoute>
                <ExercisesProvider>
                  <Layout />
                </ExercisesProvider>
              </ProtectedRoute>
            }
          >
            <Route path="/" element={<Dashboard />} />
            <Route path="/exercicios" element={<Exercises />} />
            <Route path="/exercicios/:id" element={<ExerciseDetail />} />
            <Route path="/novo-treino" element={<NewWorkout />} />
            <Route path="/historico" element={<History />} />
            <Route path="/perfil" element={<Profile />} />
            <Route
              path="/admin/moderacao"
              element={
                <SuperAdminRoute>
                  <AdminModeration />
                </SuperAdminRoute>
              }
            />
            <Route
              path="/admin/contas"
              element={
                <SuperAdminRoute>
                  <AdminAccounts />
                </SuperAdminRoute>
              }
            />
            <Route path="/comunidades" element={<Communities />} />
            <Route path="/comunidades/perfil/:userId" element={<PublicProfile />} />
            <Route path="/comunidades/:id" element={<CommunityDetail />} />
            <Route
              path="/admin/comunidades"
              element={
                <SuperAdminRoute>
                  <AdminCommunities />
                </SuperAdminRoute>
              }
            />
          </Route>
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  )
}
