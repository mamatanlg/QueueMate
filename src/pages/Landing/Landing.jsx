import { useState } from 'react'
import { Link, NavLink } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { useSocket } from '../../context/SocketContext'
import { padNumber } from '../../utils/formatters'
import './Landing.css'

const PUBLIC_ITEMS = [
  { to: '/dashboard', label: 'Dashboard', icon: <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="2" y="2" width="5" height="5" rx="1"/><rect x="9" y="2" width="5" height="5" rx="1"/><rect x="2" y="9" width="5" height="5" rx="1"/><rect x="9" y="9" width="5" height="5" rx="1"/></svg> },
  { to: '/display', label: 'Live Display', icon: <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="2" y="3" width="12" height="9" rx="1"/><path d="M5 14h6M8 12v2"/></svg> },
  { to: '/kiosk', label: 'Customer Kiosk', icon: <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="3" y="2" width="10" height="12" rx="1"/><path d="M6 6h4M6 9h4M6 12h2"/></svg> },
  { to: '/track', label: 'Track Position', icon: <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="8" cy="8" r="6"/><path d="M8 5v3l2 2"/></svg> },
]

const ADMIN_GROUPS = [
  {
    title: 'Operations',
    items: [
      { to: '/admin', label: 'Operate Counter', icon: <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M2 4h12M2 8h12M2 12h8"/></svg> },
      { to: '/admin?tab=analytics', label: 'Analytics', icon: <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M2 13V3M2 13h12M5 10V7M8 10V5M11 10V8"/></svg> },
      { to: '/admin?tab=announce', label: 'Announcements', icon: <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M3 6v4l8 3V3l-8 3zM3 6H2v4h1"/></svg> },
    ],
  },
  {
    title: 'Configuration',
    items: [
      { to: '/admin?tab=categories&section=services', label: 'Service Categories', icon: <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="2" y="2" width="5" height="5" rx="1"/><rect x="9" y="2" width="5" height="5" rx="1"/><rect x="2" y="9" width="5" height="5" rx="1"/><rect x="9" y="9" width="5" height="5" rx="1"/></svg> },
      { to: '/admin?tab=categories&section=counters', label: 'Counters', icon: <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M2 4h12M2 8h12M2 12h12"/></svg> },
      { to: '/admin?tab=categories&section=branches', label: 'Branches', icon: <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M3 14V6l5-4 5 4v8M6 10h4M6 14v-3h4v3"/></svg> },
      { to: '/admin?tab=categories&section=webhooks', label: 'Webhooks', icon: <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="4" cy="12" r="2"/><circle cx="12" cy="4" r="2"/><path d="M5.5 11L11 5.5"/></svg> },
    ],
  },
  {
    title: 'System',
    items: [
      { to: '/admin?tab=audit&section=log', label: 'Activity Log', icon: <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="3" y="2" width="10" height="12" rx="1"/><path d="M6 6h4M6 9h4M6 12h2"/></svg> },
      { to: '/admin?tab=audit&section=shifts', label: 'Shifts', icon: <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="8" cy="8" r="6"/><path d="M8 5v3l2 2"/></svg> },
      { to: '/admin?tab=audit&section=access', label: 'Access Control', icon: <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="3" y="7" width="10" height="7" rx="1"/><path d="M5 7V4a3 3 0 016 0v3"/></svg> },
    ],
  },
  {
    title: 'Settings',
    items: [
      { to: '/admin?tab=settings&section=appearance', label: 'Appearance', icon: <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="8" cy="8" r="6"/><path d="M8 2a6 6 0 000 12"/></svg> },
      { to: '/admin?tab=settings&section=sound', label: 'Sound & Voice', icon: <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M3 6v4h2l3 3V3L5 6H3z"/><path d="M11 5.5a3 3 0 010 5"/></svg> },
      { to: '/admin?tab=settings&section=display', label: 'Display', icon: <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="1" y="2" width="14" height="9" rx="1"/><path d="M5 14h6M8 11v3"/></svg> },
      { to: '/admin?tab=settings&section=automation', label: 'Automation', icon: <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="8" cy="8" r="2"/><path d="M8 1v2M8 13v2M1 8h2M13 8h2"/></svg> },
      { to: '/admin?tab=settings&section=signage', label: 'Digital Signage', icon: <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="2" y="3" width="12" height="10" rx="1"/><path d="M6 6l4 2.5L6 11V6z"/></svg> },
      { to: '/admin?tab=settings&section=advanced', label: 'Advanced', icon: <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M11 2H5l-3 6 3 6h6l3-6-3-6z"/></svg> },
    ],
  },
]

// Admin password is checked entirely client-side. Anyone reading the JS
// bundle can find this string — that's accepted, since admin auth here is
// a UX gate (hide config from receptionists), not a real security boundary.
// To change: edit this string and src/pages/Admin/Admin.jsx, then redeploy.
const ADMIN_PASSWORD = '2811'

export default function Landing() {
  const { state } = useSocket()
  const waiting = state.tickets.filter(t => t.status === 'waiting').length
  const served = state.tickets.filter(t => t.status === 'served').length
  const activeCounters = state.counters.filter(c => c.status === 'open').length

  const [isAdmin, setIsAdmin] = useState(() => sessionStorage.getItem('queueIsAdmin') === 'true')
  const [pwModal, setPwModal] = useState(false)
  const [pwInput, setPwInput] = useState('')
  const [pwError, setPwError] = useState(false)

  const handleUnlock = () => {
    if (!pwInput.trim()) return
    if (pwInput.trim() === ADMIN_PASSWORD) {
      setIsAdmin(true)
      sessionStorage.setItem('queueIsAdmin', 'true')
      setPwModal(false)
      setPwInput('')
      setPwError(false)
    } else {
      setPwError(true)
    }
  }

  const handleLock = () => {
    setIsAdmin(false)
    sessionStorage.removeItem('queueIsAdmin')
  }

  return (
    <div className="land">
      {/* Sidebar */}
      <aside className="land-sidenav">
        <div className="land-sidenav-head">
          <div className="land-mark">Q</div>
          <div>
            <div className="land-sidenav-title">Queue System</div>
            <div className="land-sidenav-sub">v1.0</div>
          </div>
        </div>

        <div className="land-sidenav-list">
          {/* Always visible — Operate Counter only */}
          <div className="land-sidenav-section">Operations</div>
          <Link to="/admin" className="land-sidenav-item">
            <span className="land-sidenav-icon"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M2 4h12M2 8h12M2 12h8"/></svg></span>
            <span>Operate Counter</span>
          </Link>

          {/* Admin-locked items */}
          {isAdmin && (
            <>
              <div className="land-sidenav-section">Pages</div>
              {PUBLIC_ITEMS.map(item => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end
                  className={({ isActive }) => `land-sidenav-item ${isActive ? 'land-sidenav-item--active' : ''}`}
                >
                  <span className="land-sidenav-icon">{item.icon}</span>
                  <span>{item.label}</span>
                </NavLink>
              ))}

              {ADMIN_GROUPS.map(group => (
                <div key={group.title}>
                  <div className="land-sidenav-section">{group.title}</div>
                  {group.items.filter(i => i.to !== '/admin').map(item => (
                    <Link key={item.to} to={item.to} className="land-sidenav-item">
                      <span className="land-sidenav-icon">{item.icon}</span>
                      <span>{item.label}</span>
                    </Link>
                  ))}
                </div>
              ))}
            </>
          )}
        </div>

        <div className="land-sidenav-foot">
          {isAdmin ? (
            <button className="land-sidenav-lock land-sidenav-lock--unlocked" onClick={handleLock}>
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="3" y="7" width="10" height="7" rx="1"/><path d="M5 7V4a3 3 0 016 0"/></svg>
              Lock Admin
            </button>
          ) : (
            <button className="land-sidenav-lock" onClick={() => setPwModal(true)}>
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="3" y="7" width="10" height="7" rx="1"/><path d="M5 7V4a3 3 0 016 0v3"/></svg>
              Unlock Admin
            </button>
          )}
          <div className="land-sidenav-foot-stat">
            <span className="land-sidenav-foot-val">{activeCounters}</span>
            <span className="land-sidenav-foot-label">counters open</span>
          </div>
        </div>
      </aside>

      {/* Main content */}
      <div className="land-main">
        <div className="land-bg">
          <div className="land-orb land-orb--1" />
          <div className="land-orb land-orb--2" />
          <div className="land-orb land-orb--3" />
        </div>

        <div className="land-scroll">
          <div className="land-inner">
            <motion.div
              className="land-hero"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6 }}
            >
              <h1 className="land-title">Queue System</h1>
              <p className="land-subtitle ar">نظام إدارة الطوابير</p>
            </motion.div>

            <motion.div
              className="land-stats"
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.15, duration: 0.5 }}
            >
              <div className="land-stat">
                <span className="land-stat-val">{waiting}</span>
                <span className="land-stat-label">Waiting</span>
              </div>
              <div className="land-stat-sep" />
              <div className="land-stat">
                <span className="land-stat-val">{served}</span>
                <span className="land-stat-label">Served</span>
              </div>
              <div className="land-stat-sep" />
              <div className="land-stat">
                <span className="land-stat-val">{activeCounters}</span>
                <span className="land-stat-label">Counters</span>
              </div>
            </motion.div>

            {/* Quick links grid */}
            <motion.div
              className="land-quick"
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.25, duration: 0.5 }}
            >
              <Link to="/dashboard" className="land-quick-card land-quick-card--primary">
                <svg width="22" height="22" viewBox="0 0 22 22" fill="none" stroke="currentColor" strokeWidth="1.8">
                  <rect x="2" y="2" width="7" height="7" rx="2" />
                  <rect x="13" y="2" width="7" height="7" rx="2" />
                  <rect x="2" y="13" width="7" height="7" rx="2" />
                  <rect x="13" y="13" width="7" height="7" rx="2" />
                </svg>
                <div>
                  <span className="land-quick-label">Dashboard</span>
                  <span className="land-quick-desc">Full overview and controls</span>
                </div>
              </Link>

              <div className="land-quick-row">
                <Link to="/display" className="land-quick-card">
                  <div className="land-quick-icon" style={{ background: 'var(--green-dim)', color: 'var(--green)' }}>
                    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.6"><rect x="2" y="3" width="14" height="9" rx="1"/><path d="M6 15h6M9 12v3"/></svg>
                  </div>
                  <span className="land-quick-label">Display</span>
                </Link>
                <Link to="/kiosk" className="land-quick-card">
                  <div className="land-quick-icon" style={{ background: 'var(--amber-dim)', color: 'var(--amber)' }}>
                    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.6"><rect x="4" y="2" width="10" height="14" rx="1"/><path d="M7 6h4M7 9h4M7 12h2"/></svg>
                  </div>
                  <span className="land-quick-label">Kiosk</span>
                </Link>
                <Link to="/track" className="land-quick-card">
                  <div className="land-quick-icon" style={{ background: 'rgba(148,163,184,0.1)', color: 'var(--gray-1)' }}>
                    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.6"><circle cx="9" cy="9" r="6"/><path d="M9 6v3l2 2"/></svg>
                  </div>
                  <span className="land-quick-label">Track</span>
                </Link>
              </div>
            </motion.div>

            {/* Currently serving preview */}
            {state.counters.some(c => c.currentTicket) && (
              <motion.div
                className="land-serving"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.5 }}
              >
                <span className="land-serving-label">Now Serving</span>
                <div className="land-serving-nums">
                  {state.counters.filter(c => c.currentTicket).map(c => {
                    const t = state.tickets.find(tk => tk.number === c.currentTicket)
                    if (!t) return null
                    const cat = state.categories.find(ct => ct.id === t.categoryId)
                    return (
                      <div key={c.id} className="land-serving-item">
                        <span className="land-serving-counter">{c.name}</span>
                        <span className="land-serving-num">{t.displayNumber || padNumber(t.number)}</span>
                        {cat && <span className="land-serving-cat" style={{ color: cat.color }}>{cat.name}</span>}
                      </div>
                    )
                  })}
                </div>
              </motion.div>
            )}
          </div>
        </div>
      </div>

      {/* Admin password modal */}
      <AnimatePresence>
        {pwModal && (
          <motion.div className="land-pw-overlay" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <motion.div className="land-pw-card"
              initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}>
              <svg width="28" height="28" viewBox="0 0 28 28" fill="none" stroke="var(--blue)" strokeWidth="1.5" style={{ marginBottom: 12 }}>
                <rect x="5" y="13" width="18" height="12" rx="2"/>
                <path d="M9 13V8a5 5 0 0110 0v5"/>
              </svg>
              <h2>Admin Access</h2>
              <p>Enter the admin password to unlock all features.</p>
              <input
                className="land-pw-input"
                type="password"
                placeholder="Password"
                value={pwInput}
                onChange={e => { setPwInput(e.target.value); setPwError(false) }}
                onKeyDown={e => e.key === 'Enter' && handleUnlock()}
                autoFocus
              />
              {pwError && <div className="land-pw-error">Wrong password</div>}
              <div className="land-pw-btns">
                <button className="land-pw-btn land-pw-btn--cancel" onClick={() => { setPwModal(false); setPwInput(''); setPwError(false) }}>Cancel</button>
                <button className="land-pw-btn land-pw-btn--ok" onClick={handleUnlock}>Unlock</button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
