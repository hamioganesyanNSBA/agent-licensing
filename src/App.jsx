import { Routes, Route, NavLink, Navigate } from 'react-router-dom'
import { SignedIn, SignedOut, SignIn, UserButton, useUser } from '@clerk/clerk-react'
import Dashboard from './pages/Dashboard.jsx'
import Agents from './pages/Agents.jsx'
import AgentDetail from './pages/AgentDetail.jsx'
import Licenses from './pages/Licenses.jsx'
import Appointments from './pages/Appointments.jsx'
import Imports from './pages/Imports.jsx'
import SunfireExport from './pages/SunfireExport.jsx'

const ADMIN_EMAILS = (import.meta.env.VITE_ADMIN_EMAILS || '')
  .split(',').map(s => s.trim().toLowerCase()).filter(Boolean)

function AdminGate({ children }) {
  const { user } = useUser()
  const email = user?.primaryEmailAddress?.emailAddress?.toLowerCase()
  if (!email) return null
  if (ADMIN_EMAILS.length && !ADMIN_EMAILS.includes(email)) {
    return (
      <div style={{ padding: 40 }}>
        <h2>Not authorized</h2>
        <p>{email} is not on the admin list. Contact your administrator.</p>
      </div>
    )
  }
  return children
}

export default function App() {
  return (
    <>
      <SignedOut>
        <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 80 }}>
          <SignIn routing="hash" />
        </div>
      </SignedOut>
      <SignedIn>
        <AdminGate>
          <div className="layout">
            <aside className="sidebar">
              <div className="brand">
                <img src="/nsba-logo.png" alt="NSBA" />
                <h1>Licensing</h1>
              </div>
              <nav>
                <NavLink to="/" end>Dashboard</NavLink>
                <NavLink to="/agents">Agents</NavLink>
                <NavLink to="/licenses">Licenses</NavLink>
                <NavLink to="/appointments">Appointments</NavLink>
                <NavLink to="/imports">Imports</NavLink>
                <NavLink to="/sunfire">Sunfire Export</NavLink>
              </nav>
            </aside>
            <main className="main">
              <div className="topbar">
                <div />
                <UserButton />
              </div>
              <Routes>
                <Route path="/" element={<Dashboard />} />
                <Route path="/agents" element={<Agents />} />
                <Route path="/agents/:npn" element={<AgentDetail />} />
                <Route path="/licenses" element={<Licenses />} />
                <Route path="/appointments" element={<Appointments />} />
                <Route path="/imports" element={<Imports />} />
                <Route path="/sunfire" element={<SunfireExport />} />
                <Route path="*" element={<Navigate to="/" />} />
              </Routes>
            </main>
          </div>
        </AdminGate>
      </SignedIn>
    </>
  )
}
