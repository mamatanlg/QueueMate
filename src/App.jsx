import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { AuthProvider } from './context/AuthContext'
import { useAuth } from './hooks/useAuth'
import Cashier from './pages/Cashier/Cashier'
import AdminDashboard from './pages/Admin/AdminDashboard'
import StudentMobile from './pages/StudentMobile/StudentMobile'
import PublicDisplay from './pages/PublicDisplay/PublicDisplay'

function RequireRole({ role, children }) {
  const { session, sessionNotice } = useAuth()
  const location = useLocation()

  if (!session) {
    return (
      <Navigate
        to="/cashier"
        replace
        state={{
          from: location.pathname,
          ...(sessionNotice ? { notice: sessionNotice } : {}),
        }}
      />
    )
  }
  const authorized = role === 'admin'
    ? ['admin', 'system_admin'].includes(session.role)
    : session.role === role
  if (!authorized) {
    return <Navigate
      to={['admin', 'system_admin'].includes(session.role) ? '/admin' : '/cashier'}
      replace
    />
  }

  return children
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/cashier" element={<Cashier />} />
          <Route
            path="/admin"
            element={(
              <RequireRole role="admin">
                <AdminDashboard />
              </RequireRole>
            )}
          />
          <Route path="/display" element={<PublicDisplay />} />
          <Route path="/mobile" element={<StudentMobile />} />
          <Route path="/" element={<Navigate to="/cashier" replace />} />
          <Route path="*" element={<Navigate to="/cashier" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  )
}
