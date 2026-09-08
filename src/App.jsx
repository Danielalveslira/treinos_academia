import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { AuthProvider } from './contexts/AuthContext'
import { ProtectedRoute } from './components/ProtectedRoute'
import { Layout } from './components/Layout'
import Login from './pages/Login'
import Register from './pages/Register'
import ForgotPassword from './pages/ForgotPassword'
import Dashboard from './pages/Dashboard'
import Exercises from './pages/Exercises'
import ExerciseDetail from './pages/ExerciseDetail'
import NewWorkout from './pages/NewWorkout'
import History from './pages/History'

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/cadastro" element={<Register />} />
          <Route path="/esqueci-senha" element={<ForgotPassword />} />

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
      </AuthProvider>
    </BrowserRouter>
  )
}
