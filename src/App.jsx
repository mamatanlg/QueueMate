import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import Cashier from './pages/Cashier/Cashier'
import StudentMobile from './pages/StudentMobile/StudentMobile'
import PublicDisplay from './pages/PublicDisplay/PublicDisplay'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/cashier" element={<Cashier />} />
        <Route path="/display" element={<PublicDisplay />} />
        <Route path="/mobile" element={<StudentMobile />} />
        <Route path="/" element={<Navigate to="/cashier" replace />} />
        <Route path="*" element={<Navigate to="/cashier" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
