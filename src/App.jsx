import { lazy, Suspense } from 'react'
import { BrowserRouter, Routes, Route, Outlet, Navigate } from 'react-router-dom'
import { AuthProvider } from './contexts/AuthContext'
import { WalletProvider } from './contexts/WalletContext'
import { ExercisesProvider } from './contexts/ExercisesContext'
import { ProtectedRoute } from './components/ProtectedRoute'
import { SuperAdminRoute } from './components/SuperAdminRoute'
import { Layout } from './components/Layout'
import { PageFallback } from './components/PageFallback'
import { routeLoaders } from './routeLoaders'
import { COMMENTS_ENABLED } from './features/comments/config'

const MyAds = lazy(() => import('./pages/MyAds'))
const Login = lazy(() => import('./pages/Login'))
const Register = lazy(() => import('./pages/Register'))
const ForgotPassword = lazy(() => import('./pages/ForgotPassword'))
const ConfirmEmail = lazy(() => import('./pages/ConfirmEmail'))
const ResetPassword = lazy(() => import('./pages/ResetPassword'))
const Dashboard = lazy(routeLoaders['/app'])
const Exercises = lazy(routeLoaders['/exercicios'])
const ExerciseDetail = lazy(routeLoaders['/exercicios/:id'])
const NewWorkout = lazy(routeLoaders['/novo-treino'])
const History = lazy(routeLoaders['/historico'])
const Progress = lazy(routeLoaders['/progresso'])
const Communities = lazy(routeLoaders['/comunidades'])
const CommunityDetail = lazy(() => import('./pages/CommunityDetail'))
const AdminCommunities = lazy(() => import('./pages/AdminCommunities'))
const AdminSponsoredAds = lazy(() => import('./pages/AdminSponsoredAds'))
const PublicProfile = lazy(() => import('./pages/PublicProfile'))
const Profile = lazy(() => import('./pages/Profile'))
const LegalDocument = lazy(() => import('./pages/LegalDocument'))
const Support = lazy(() => import('./pages/Support'))
const AdminModeration = lazy(() => import('./pages/AdminModeration'))
const AdminAccounts = lazy(() => import('./pages/AdminAccounts'))
const AdminProfessionalListings = lazy(() => import('./pages/AdminProfessionalListings'))
const AdminAccountDeletions = lazy(() => import('./pages/AdminAccountDeletions'))
const EvoCash = lazy(() => import('./pages/EvoCash'))
const EconomyGuide = lazy(() => import('./pages/EconomyGuide'))
const AdminCashPurchases = lazy(() => import('./pages/AdminCashPurchases'))
const AdminPromotions = lazy(() => import('./pages/AdminPromotions'))
const AdminExerciseVisuals = lazy(() => import('./pages/AdminExerciseVisuals'))
const MyPromotions = lazy(() => import('./pages/MyPromotions'))
const ProfessionalListing = lazy(() => import('./pages/ProfessionalListing'))
const MyProfessionalListing = lazy(() => import('./pages/MyProfessionalListing'))
const CreateCommunity = lazy(() => import('./pages/CreateCommunity'))
const CommentContextPage = lazy(() => import('./features/comments/pages/CommentContextPage'))
const NotFound = lazy(() => import('./pages/NotFound'))

export function AppRoutes() {
  return (
    <Routes>
      <Route
        element={
          <Suspense fallback={<PageFallback />}>
            <Outlet />
          </Suspense>
        }
      >
        {/* Shell antigo de um PWA instalado ainda pode abrir em / quando está offline. */}
        <Route path="/" element={<Navigate to="/app" replace />} />
        <Route path="/login" element={<Login />} />
        <Route path="/cadastro" element={<Register />} />
        <Route path="/esqueci-senha" element={<ForgotPassword />} />
        <Route path="/confirmar-email" element={<ConfirmEmail />} />
        <Route path="/redefinir-senha" element={<ResetPassword />} />
        <Route path="/regras-da-comunidade" element={<LegalDocument documentId="community" />} />
        <Route path="/termos-de-uso" element={<LegalDocument documentId="terms" />} />
        <Route path="/politica-de-privacidade" element={<LegalDocument documentId="privacy" />} />
        <Route
          path="/termos-publicacao-vitrine"
          element={<LegalDocument documentId="showcase-publication-terms" />}
        />
        <Route path="/atendimento" element={<Support />} />
        <Route path="/profissionais/:listingId" element={<ProfessionalListing />} />
        <Route path="*" element={<NotFound />} />
      </Route>

      <Route
        element={
          <ProtectedRoute>
            <Layout />
          </ProtectedRoute>
        }
      >
        <Route
          element={
            <ExercisesProvider>
              <Outlet />
            </ExercisesProvider>
          }
        >
          <Route path="/app" element={<Dashboard />} />
          <Route path="/exercicios" element={<Exercises />} />
          <Route path="/exercicios/:id" element={<ExerciseDetail />} />
          <Route path="/novo-treino" element={<NewWorkout />} />
          <Route path="/historico" element={<History />} />
          <Route path="/progresso" element={<Progress />} />
        </Route>
        <Route path="/meus-anuncios" element={<MyAds />} />
        <Route path="/perfil" element={<Profile />} />
        <Route path="/evocash" element={<EvoCash />} />
        <Route path="/entenda-suas-moedas" element={<EconomyGuide />} />
        <Route path="/minhas-promocoes" element={<MyPromotions />} />
        {/* O gate de Termos de Publicação (showcase_legal_policy.published) é responsabilidade
            de MyProfessionalListing.jsx, só na ação de publicar -- criar/editar rascunho não
            depende disso (ver create_professional_listing/save_professional_listing_draft,
            nenhuma das duas consulta showcase_legal_policy). A rota sempre renderiza a
            página; ela decide sozinha o que mostrar com base no profile/listing reais. */}
        <Route path="/minha-vitrine" element={<MyProfessionalListing />} />
        <Route path="/comunidades/criar" element={<CreateCommunity />} />
        <Route
          path="/admin/compras-evocash"
          element={
            <SuperAdminRoute>
              <AdminCashPurchases />
            </SuperAdminRoute>
          }
        />
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
        <Route
          path="/admin/vitrines"
          element={
            <SuperAdminRoute>
              <AdminProfessionalListings />
            </SuperAdminRoute>
          }
        />
        <Route
          path="/admin/exclusao-contas"
          element={
            <SuperAdminRoute>
              <AdminAccountDeletions />
            </SuperAdminRoute>
          }
        />
        <Route path="/comunidades" element={<Communities />} />
        <Route path="/comunidades/perfil/:userId" element={<PublicProfile />} />
        <Route path="/comunidades/:id" element={<CommunityDetail />} />
        {COMMENTS_ENABLED && (
          <Route
            path="/comunidades/:id/publicacoes/:statusId/comentarios/:commentId"
            element={<CommentContextPage />}
          />
        )}
        <Route
          path="/admin/comunidades"
          element={
            <SuperAdminRoute>
              <AdminCommunities />
            </SuperAdminRoute>
          }
        />
        <Route
          path="/admin/parcerias"
          element={
            <SuperAdminRoute>
              <AdminSponsoredAds />
            </SuperAdminRoute>
          }
        />
        <Route
          path="/admin/promocoes"
          element={
            <SuperAdminRoute>
              <AdminPromotions />
            </SuperAdminRoute>
          }
        />
        <Route
          path="/admin/exercicios-imagens"
          element={
            <SuperAdminRoute>
              <AdminExerciseVisuals />
            </SuperAdminRoute>
          }
        />
      </Route>
    </Routes>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <WalletProvider>
          <AppRoutes />
        </WalletProvider>
      </AuthProvider>
    </BrowserRouter>
  )
}
