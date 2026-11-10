import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { useSocket } from '../../context/SocketContext'
import { padNumber, formatTime } from '../../utils/formatters'
import './Dashboard.css'

export default function Dashboard() {
  const { state, emit, emitVoid } = useSocket()
  const [clock, setClock] = useState(new Date())
  const isAdmin = sessionStorage.getItem('queueIsAdmin') === 'true'

  useEffect(() => {
    const i = setInterval(() => setClock(new Date()), 1000)
    return () => clearInterval(i)
  }, [])

  const waiting = state.tickets.filter(t => t.status === 'waiting').sort((a, b) => a.number - b.number)
  const held = state.tickets.filter(t => t.status === 'held')
  const served = state.tickets.filter(t => t.status === 'served')
  const clockStr = clock.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true })

  return (
    <div className="dash">
      {/* Header */}
      <header className="dash-header">
        <Link to="/" className="dash-back">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M10 3L5 8l5 5"/></svg>
        </Link>
        <h1 className="dash-title">Dashboard</h1>
        <span className="dash-clock">{clockStr}</span>
      </header>

      <div className="dash-body">
        {/* Left: Counters overview */}
        <div className="dash-left">
          <div className="dash-section-label">Counters</div>
          <div className="dash-counters">
            {state.counters.map(counter => {
              const ticket = counter.currentTicket
                ? state.tickets.find(t => t.number === counter.currentTicket)
                : null
              const cat = ticket ? state.categories.find(c => c.id === ticket.categoryId) : null

              return (
                <div key={counter.id} className={`dash-counter ${counter.status === 'closed' ? 'dash-counter--closed' : ''}`}>
                  <div className="dash-counter-top">
                    <span className="dash-counter-name">{counter.name}</span>
                    <span className={`dash-counter-status ${counter.status}`}>{counter.status}</span>
                  </div>
                  {counter.operatorName && (
                    <span className="dash-counter-op">{counter.operatorName}</span>
                  )}
                  <div className="dash-counter-serving">
                    {ticket ? (
                      <>
                        <span className="dash-counter-num">{(ticket.displayNumber || padNumber(ticket.number))}</span>
                        {cat && <span className="dash-counter-cat" style={{ color: cat.color }}>{cat.name}</span>}
                      </>
                    ) : (
                      <span className="dash-counter-idle">—</span>
                    )}
                  </div>
                  {isAdmin && (
                    <div className="dash-counter-actions">
                      <button
                        className="dash-btn dash-btn--primary"
                        onClick={() => emit('ticket:call', { counterId: counter.id })}
                        disabled={counter.status === 'closed'}
                      >
                        Next
                      </button>
                      <button
                        className="dash-btn"
                        onClick={() => emit('ticket:recall', { counterId: counter.id })}
                        disabled={!ticket}
                      >
                        Recall
                      </button>
                      <button
                        className="dash-btn"
                        onClick={() => emit('ticket:complete', { counterId: counter.id })}
                        disabled={!ticket}
                      >
                        Done
                      </button>
                      <button
                        className="dash-btn"
                        onClick={() => emit('ticket:skip', { counterId: counter.id })}
                        disabled={!ticket}
                      >
                        Skip
                      </button>
                      <button
                        className="dash-btn"
                        onClick={() => emit('ticket:hold', { counterId: counter.id })}
                        disabled={!ticket}
                      >
                        Hold
                      </button>
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          {/* Quick stats */}
          <div className="dash-stats-row">
            <div className="dash-stat-box">
              <span className="dash-stat-num">{waiting.length}</span>
              <span className="dash-stat-label">Waiting</span>
            </div>
            <div className="dash-stat-box">
              <span className="dash-stat-num">{served.length}</span>
              <span className="dash-stat-label">Served</span>
            </div>
            <div className="dash-stat-box">
              <span className="dash-stat-num">{state.nextTicketNumber - 1}</span>
              <span className="dash-stat-label">Issued</span>
            </div>
          </div>
        </div>

        {/* Right: Queue list */}
        <div className="dash-right">
          {/* Upcoming */}
          <div className="dash-section-label">Upcoming ({waiting.length})</div>
          <div className="dash-queue-list">
            {waiting.map(t => {
              const cat = state.categories.find(c => c.id === t.categoryId)
              return (
                <div key={t.number} className="dash-queue-item">
                  <span className="dash-queue-bar" style={{ background: cat?.color }} />
                  <span className="dash-queue-num">{(t.displayNumber || padNumber(t.number))}</span>
                  <span className="dash-queue-cat" style={{ color: cat?.color }}>{cat?.name}</span>
                  <span className="dash-queue-time">{formatTime(t.createdAt)}</span>
                </div>
              )
            })}
            {waiting.length === 0 && <p className="dash-empty">No one waiting</p>}
          </div>

          {/* Held */}
          {held.length > 0 && (
            <>
              <div className="dash-section-label" style={{ marginTop: 20, color: 'var(--amber)' }}>On Hold ({held.length})</div>
              <div className="dash-queue-list">
                {held.map(t => {
                  const cat = state.categories.find(c => c.id === t.categoryId)
                  return (
                    <div key={t.number} className="dash-queue-item" style={{ background: 'var(--amber-dim)', borderRadius: 6 }}>
                      <span className="dash-queue-bar" style={{ background: 'var(--amber)' }} />
                      <span className="dash-queue-num">{(t.displayNumber || padNumber(t.number))}</span>
                      <span className="dash-queue-cat" style={{ color: cat?.color }}>{cat?.name}</span>
                    </div>
                  )
                })}
              </div>
            </>
          )}

          {/* Recently served */}
          <div className="dash-section-label" style={{ marginTop: 20 }}>Recently Served</div>
          <div className="dash-queue-list dash-queue-list--served">
            {served.sort((a, b) => b.completedAt - a.completedAt).slice(0, 15).map(t => (
              <div key={t.number} className="dash-queue-item dash-queue-item--served">
                <span className="dash-queue-num">{(t.displayNumber || padNumber(t.number))}</span>
                <span className="dash-queue-time">{formatTime(t.completedAt)}</span>
              </div>
            ))}
          </div>

          {/* Announcements */}
          {state.announcements.length > 0 && (
            <>
              <div className="dash-section-label" style={{ marginTop: 20 }}>Announcements</div>
              {state.announcements.map((a, i) => (
                <div key={i} className="dash-announce">{a}</div>
              ))}
            </>
          )}
        </div>
      </div>

      {/* Bottom nav */}
      <nav className="dash-nav">
        <Link to="/admin" className="dash-nav-link">Admin</Link>
        <Link to="/display" className="dash-nav-link">Display</Link>
        <Link to="/kiosk" className="dash-nav-link">Kiosk</Link>
        <Link to="/track" className="dash-nav-link">Track</Link>
      </nav>
    </div>
  )
}
