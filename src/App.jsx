import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { SocketProvider } from './context/SocketContext'
import ThemeApplier from './components/ThemeApplier'
import Landing from './pages/Landing/Landing'
import Dashboard from './pages/Dashboard/Dashboard'
import Display from './pages/Display/Display'
import Admin from './pages/Admin/Admin'
import Kiosk from './pages/Kiosk/Kiosk'
import Track from './pages/Track/Track'

export default function App() {
  return (
    <SocketProvider>
      <ThemeApplier />
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/display" element={<Display />} />
          <Route path="/admin" element={<Admin />} />
          <Route path="/kiosk" element={<Kiosk />} />
          <Route path="/track" element={<Track />} />
          <Route path="/track/:ticketNumber" element={<Track />} />
        </Routes>
      </BrowserRouter>
    </SocketProvider>
  )
}
