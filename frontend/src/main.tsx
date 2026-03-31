import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import './index.css'
import Layout from './components/Layout'
import Landing from './pages/Landing'
import Login from './pages/Login'
import Officer from './pages/Officer'
import CommandCenter from './pages/CommandCenter'
import MarvelDashboard from './pages/MarvelDashboard'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        {/* MARVEL Cyberpunk Dashboard — standalone, no Layout wrapper */}
        <Route path="/" element={<MarvelDashboard />} />
        <Route path="/dashboard" element={<MarvelDashboard />} />

        {/* Login page (no layout) */}
        <Route path="login" element={<Login />} />

        {/* Legacy routes still use the government Layout */}
        <Route path="/legacy" element={<Layout />}>
          <Route index element={<Landing />} />
          <Route path="officer/dashboard" element={<Officer />} />
          <Route path="command/board" element={<CommandCenter />} />
        </Route>
      </Routes>
    </BrowserRouter>
  </StrictMode>,
)
