import { useMemo, useState } from 'react'
import {
  createInitialQueue,
  demoCashier,
  demoCredentials,
  initialActivity,
  initialCurrentTicket,
  initialDailyStats,
} from './cashierMockData'
import './Cashier.css'

const navigationItems = [
  { id: 'counter', label: 'Active Counter', icon: 'counter' },
  { id: 'queue', label: 'Shared Queue', icon: 'queue' },
  { id: 'activity', label: 'Activity Log', icon: 'activity' },
]

function Icon({ name, size = 18 }) {
  const paths = {
    activity: <><path d="M3 12h4l2.2-7 4.1 14 2.2-7H21" /></>,
    arrow: <><path d="M5 12h14" /><path d="m12 5 7 7-7 7" /></>,
    bell: <><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9" /><path d="M10 21h4" /></>,
    check: <path d="m5 12 4 4L19 6" />,
    chevron: <path d="m9 18 6-6-6-6" />,
    clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
    counter: <><path d="M4 20V8l8-5 8 5v12" /><path d="M2 20h20M9 20v-6h6v6" /></>,
    logout: <><path d="M10 17l5-5-5-5" /><path d="M15 12H3" /><path d="M12 3h6a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-6" /></>,
    queue: <><path d="M8 6h13M8 12h13M8 18h13" /><path d="M3 6h.01M3 12h.01M3 18h.01" /></>,
    user: <><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></>,
    window: <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 9h18M8 9v11" /></>,
  }

  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {paths[name]}
    </svg>
  )
}

function formatClock(date) {
  return date.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  })
}

function LoginScreen({ onLogin }) {
  const [username, setUsername] = useState(demoCredentials.username)
  const [password, setPassword] = useState(demoCredentials.password)
  const [error, setError] = useState('')

  function handleSubmit(event) {
    event.preventDefault()
    if (username !== demoCredentials.username || password !== demoCredentials.password) {
      setError('Those demo credentials do not match. Use the details shown below.')
      return
    }
    onLogin()
  }

  return (
    <main className="cashier-login">
      <section className="cashier-login__brand">
        <a className="cashier-brand" href="/cashier" aria-label="QueueMate home">
          <span className="cashier-brand__mark">Q</span>
          <span>Queue<span>Mate</span></span>
        </a>
        <div className="cashier-login__message">
          <span className="cashier-eyebrow">BUSINESS OFFICE · SAN ISIDRO COLLEGE</span>
          <h1>A calmer way to keep the line moving.</h1>
          <p>One clear view of your counter, your next ticket, and the people waiting.</p>
        </div>
        <div className="cashier-login__note">
          <span className="cashier-login__note-icon"><Icon name="window" /></span>
          <span><strong>Built for your counter</strong><small>Simple, focused queue management</small></span>
        </div>
        <div className="cashier-login__decoration cashier-login__decoration--one" />
        <div className="cashier-login__decoration cashier-login__decoration--two" />
      </section>

      <section className="cashier-login__panel">
        <div className="cashier-login__form-wrap">
          <span className="cashier-eyebrow cashier-eyebrow--light">CASHIER PORTAL</span>
          <h2>Welcome back</h2>
          <p className="cashier-login__subheading">Sign in to manage your assigned window.</p>

          <form className="cashier-form" onSubmit={handleSubmit}>
            <label htmlFor="cashier-username">Username</label>
            <input
              id="cashier-username"
              autoComplete="username"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
            />
            <label htmlFor="cashier-password">Password</label>
            <input
              id="cashier-password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
            {error && <p className="cashier-form__error" role="alert">{error}</p>}
            <button className="cashier-button cashier-button--primary cashier-form__submit" type="submit">
              Sign in <Icon name="arrow" size={17} />
            </button>
          </form>

          <div className="cashier-demo-hint">
            <span className="cashier-demo-hint__dot" />
            <div>
              <strong>Demo preview</strong>
              <p>Username: <code>{demoCredentials.username}</code></p>
              <p>Password: <code>{demoCredentials.password}</code></p>
            </div>
          </div>
          <p className="cashier-login__footnote">This preview uses local mock data. No real authentication is performed.</p>
        </div>
      </section>
    </main>
  )
}

function StatCard({ label, value, note, tone }) {
  return (
    <article className="cashier-stat-card">
      <div className={`cashier-stat-card__icon cashier-stat-card__icon--${tone}`}>
        <Icon name={tone === 'complete' ? 'check' : tone === 'skip' ? 'arrow' : 'queue'} size={17} />
      </div>
      <div>
        <p>{label}</p>
        <strong>{value}</strong>
        <span>{note}</span>
      </div>
    </article>
  )
}

function TicketRow({ ticket, position }) {
  return (
    <div className="cashier-ticket-row">
      <span className="cashier-ticket-row__position">{String(position).padStart(2, '0')}</span>
      <strong className="cashier-ticket-row__number">{ticket.number}</strong>
      <span className={`cashier-type-pill ${ticket.type === 'SOA' ? 'cashier-type-pill--blue' : ticket.type === 'Payment' ? 'cashier-type-pill--teal' : 'cashier-type-pill--violet'}`}>
        {ticket.type}
      </span>
      <span className="cashier-ticket-row__time">{ticket.issuedAt}</span>
    </div>
  )
}

function CashierDashboard({ onLogout }) {
  const [available, setAvailable] = useState(true)
  const [view, setView] = useState('counter')
  const [waiting, setWaiting] = useState(createInitialQueue)
  const [currentTicket, setCurrentTicket] = useState(initialCurrentTicket)
  const [stats, setStats] = useState(initialDailyStats)
  const [activity, setActivity] = useState(initialActivity)
  const [notice, setNotice] = useState('')
  const [now, setNow] = useState(() => new Date())

  const dateLabel = useMemo(() => now.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  }), [now])

  function recordActivity(action, ticket) {
    const time = formatClock(new Date())
    setNow(new Date())
    setActivity((items) => [
      { id: `activity-${Date.now()}`, action, number: ticket.number, type: ticket.type, time },
      ...items,
    ])
    setNotice(`Ticket ${ticket.number} ${action.toLowerCase()}.`)
    window.setTimeout(() => setNotice(''), 3200)
  }

  function callNext() {
    if (!available || currentTicket || waiting.length === 0) return
    const [nextTicket, ...remaining] = waiting
    const calledAt = formatClock(new Date())
    setWaiting(remaining)
    setCurrentTicket({ ...nextTicket, calledAt })
    setStats((current) => ({ ...current, servedToday: current.servedToday + 1 }))
    recordActivity('Called', nextTicket)
  }

  function finishTicket(action) {
    if (!currentTicket) return
    const ticket = currentTicket
    setCurrentTicket(null)
    if (action === 'Completed') {
      setStats((current) => ({ ...current, completed: current.completed + 1 }))
    } else {
      setStats((current) => ({ ...current, skipped: current.skipped + 1 }))
    }
    recordActivity(action, ticket)
  }

  function changeAvailability(nextAvailable) {
    setAvailable(nextAvailable)
    setNotice(`Window marked ${nextAvailable ? 'available' : 'unavailable'}.`)
    window.setTimeout(() => setNotice(''), 3200)
  }

  const pageTitle = navigationItems.find((item) => item.id === view)?.label ?? 'Active Counter'

  return (
    <div className="cashier-app">
      <aside className="cashier-sidebar">
        <a className="cashier-brand cashier-brand--sidebar" href="/cashier" aria-label="QueueMate">
          <span className="cashier-brand__mark">Q</span>
          <span>Queue<span>Mate</span></span>
        </a>
        <div className="cashier-sidebar__caption">WORKSPACE</div>
        <nav className="cashier-nav" aria-label="Cashier sections">
          {navigationItems.map((item) => (
            <button
              className={`cashier-nav__item ${view === item.id ? 'is-active' : ''}`}
              key={item.id}
              onClick={() => setView(item.id)}
              type="button"
            >
              <Icon name={item.icon} size={19} />
              <span>{item.label}</span>
              {item.id === 'queue' && <span className="cashier-nav__count">{waiting.length}</span>}
            </button>
          ))}
        </nav>
        <div className="cashier-sidebar__spacer" />
        <div className="cashier-sidebar__counter">
          <span className="cashier-sidebar__counter-icon"><Icon name="window" size={18} /></span>
          <div><small>YOUR COUNTER</small><strong>{demoCashier.windowName}</strong></div>
          <span className={`cashier-status-dot ${available ? 'is-available' : ''}`} />
        </div>
        <div className="cashier-sidebar__profile">
          <span className="cashier-avatar">MS</span>
          <span className="cashier-sidebar__profile-name"><strong>{demoCashier.name}</strong><small>{demoCashier.role}</small></span>
          <button className="cashier-icon-button" type="button" onClick={onLogout} aria-label="Log out" title="Log out">
            <Icon name="logout" size={17} />
          </button>
        </div>
      </aside>

      <main className="cashier-main">
        <header className="cashier-topbar">
          <div className="cashier-topbar__crumb"><span>Cashier workspace</span><Icon name="chevron" size={14} /><strong>{pageTitle}</strong></div>
          <div className="cashier-topbar__right">
            <span className="cashier-preview-label"><span /> Local preview</span>
            <button type="button" className="cashier-icon-button cashier-notification-button" aria-label="Notifications">
              <Icon name="bell" size={19} /><i />
            </button>
            <div className="cashier-topbar__date"><strong>{formatClock(now)}</strong><span>{dateLabel}</span></div>
          </div>
        </header>

        <div className="cashier-content">
          <section className="cashier-page-heading">
            <div>
              <span className="cashier-eyebrow cashier-eyebrow--light">SAN ISIDRO COLLEGE · BUSINESS OFFICE</span>
              <h1>{view === 'counter' ? 'Good morning, Maria' : pageTitle}</h1>
              <p>{view === 'counter' ? 'Here’s what’s happening at your counter today.' : `A live preview of your ${pageTitle.toLowerCase()}.`}</p>
            </div>
            <div className="cashier-date-chip"><Icon name="clock" size={16} /><span>{dateLabel}</span></div>
          </section>

          {view === 'counter' && (
            <>
              <section className="cashier-window-panel">
                <div className="cashier-window-panel__identity">
                  <span className="cashier-window-panel__icon"><Icon name="window" size={20} /></span>
                  <div><span>ASSIGNED WINDOW</span><strong>{demoCashier.windowName}</strong></div>
                  <span className="cashier-window-panel__divider" />
                  <div className="cashier-window-panel__availability">
                    <span className={`cashier-availability-indicator ${available ? 'is-available' : ''}`} />
                    <div><span>STATUS</span><strong className={available ? 'text-available' : 'text-unavailable'}>{available ? 'Available' : 'Unavailable'}</strong></div>
                  </div>
                </div>
                <div className="cashier-window-controls" aria-label="Window availability">
                  <button
                    className={`cashier-availability-button ${available ? 'is-selected' : ''}`}
                    onClick={() => changeAvailability(true)}
                    type="button"
                    aria-pressed={available}
                  >
                    <span /> Available
                  </button>
                  <button
                    className={`cashier-availability-button ${!available ? 'is-selected is-unavailable' : ''}`}
                    onClick={() => changeAvailability(false)}
                    type="button"
                    aria-pressed={!available}
                  >
                    <span /> Unavailable
                  </button>
                </div>
              </section>

              <section className="cashier-stats-grid" aria-label="Today's statistics">
                <StatCard label="Waiting in queue" value={waiting.length} note="tickets in line" tone="queue" />
                <StatCard label="Completed today" value={stats.completed} note="at this window" tone="complete" />
                <StatCard label="Skipped today" value={stats.skipped} note="tickets skipped" tone="skip" />
                <StatCard label="Tickets served" value={stats.servedToday} note="today at this window" tone="served" />
              </section>

              <div className="cashier-work-grid">
                <section className="cashier-current-card">
                  <div className="cashier-card-heading">
                    <div><span className="cashier-eyebrow cashier-eyebrow--light">NOW SERVING</span><h2>Current ticket</h2></div>
                    <span className={`cashier-serving-badge ${currentTicket ? '' : 'is-idle'}`}><i />{currentTicket ? 'In service' : 'Ready for next'}</span>
                  </div>
                  {currentTicket ? (
                    <>
                      <div className="cashier-ticket-display">
                        <div className="cashier-ticket-display__number">{currentTicket.number}</div>
                        <span className={`cashier-type-pill cashier-type-pill--large ${currentTicket.type === 'SOA' ? 'cashier-type-pill--blue' : currentTicket.type === 'Payment' ? 'cashier-type-pill--teal' : 'cashier-type-pill--violet'}`}>
                          {currentTicket.type}
                        </span>
                        <span className="cashier-ticket-display__called"><Icon name="clock" size={15} /> Called at {currentTicket.calledAt}</span>
                      </div>
                      <div className="cashier-current-actions">
                        <button className="cashier-button cashier-button--complete" type="button" onClick={() => finishTicket('Completed')}>
                          <Icon name="check" size={18} /> Complete
                        </button>
                        <button className="cashier-button cashier-button--skip" type="button" onClick={() => finishTicket('Skipped')}>
                          Skip ticket
                        </button>
                      </div>
                    </>
                  ) : (
                    <div className="cashier-empty-current">
                      <span className="cashier-empty-current__icon"><Icon name="counter" size={25} /></span>
                      <strong>No ticket is being served</strong>
                      <p>Call the next ticket when you’re ready.</p>
                    </div>
                  )}
                  <button
                    className="cashier-button cashier-button--primary cashier-call-next"
                    type="button"
                    onClick={callNext}
                    disabled={!available || Boolean(currentTicket) || waiting.length === 0}
                  >
                    <Icon name="arrow" size={18} /> Call next ticket
                  </button>
                  {!available && <p className="cashier-action-hint">Mark this window available before calling the next ticket.</p>}
                  {available && !currentTicket && waiting.length === 0 && <p className="cashier-action-hint">There are no waiting tickets right now.</p>}
                </section>

                <section className="cashier-queue-card">
                  <div className="cashier-card-heading cashier-queue-card__heading">
                    <div><span className="cashier-eyebrow cashier-eyebrow--light">UP NEXT</span><h2>Waiting queue <span>{waiting.length}</span></h2></div>
                    <button className="cashier-text-button" type="button" onClick={() => setView('queue')}>View all <Icon name="arrow" size={15} /></button>
                  </div>
                  {waiting.length ? (
                    <div className="cashier-queue-list">
                      {waiting.slice(0, 5).map((ticket, index) => <TicketRow key={ticket.id} ticket={ticket} position={index + 1} />)}
                    </div>
                  ) : (
                    <div className="cashier-empty-list">The waiting queue is clear.</div>
                  )}
                  <div className="cashier-queue-foot"><span><span className="cashier-queue-foot__dot" /> Queue updates are local to this preview</span><span>Oldest first</span></div>
                </section>
              </div>
            </>
          )}

          {view === 'queue' && (
            <section className="cashier-list-page">
              <div className="cashier-list-page__summary"><strong>{waiting.length} tickets waiting</strong><span>Tickets are shown in call order.</span></div>
              {waiting.length ? (
                <div className="cashier-queue-list cashier-queue-list--full">
                  {waiting.map((ticket, index) => <TicketRow key={ticket.id} ticket={ticket} position={index + 1} />)}
                </div>
              ) : <div className="cashier-empty-list">The waiting queue is clear.</div>}
              <button className="cashier-button cashier-button--primary cashier-list-page__action" type="button" onClick={() => setView('counter')}>Back to active counter</button>
            </section>
          )}

          {view === 'activity' && (
            <section className="cashier-list-page">
              <div className="cashier-list-page__summary"><strong>Today’s activity</strong><span>Recent ticket actions at {demoCashier.windowName}.</span></div>
              <div className="cashier-activity-list">
                {activity.map((item) => (
                  <article className="cashier-activity-row" key={item.id}>
                    <span className={`cashier-activity-row__icon ${item.action === 'Completed' ? 'is-completed' : item.action === 'Skipped' ? 'is-skipped' : ''}`}>
                      <Icon name={item.action === 'Completed' ? 'check' : item.action === 'Skipped' ? 'arrow' : 'counter'} size={17} />
                    </span>
                    <div className="cashier-activity-row__description"><strong>{item.action} ticket {item.number}</strong><span>{item.type} · {demoCashier.windowName}</span></div>
                    <time>{item.time}</time>
                  </article>
                ))}
              </div>
              <button className="cashier-button cashier-button--primary cashier-list-page__action" type="button" onClick={() => setView('counter')}>Back to active counter</button>
            </section>
          )}

          <footer className="cashier-footer"><span>QueueMate <b>·</b> Cashier workspace</span><span>Local frontend preview</span></footer>
        </div>
      </main>
      {notice && <div className="cashier-toast" role="status"><span><Icon name="check" size={16} /></span>{notice}</div>}
    </div>
  )
}

export default function Cashier() {
  const [loggedIn, setLoggedIn] = useState(false)

  return (
    <>
      <div className="cashier-desktop-interface">
        {loggedIn
          ? <CashierDashboard onLogout={() => setLoggedIn(false)} />
          : <LoginScreen onLogin={() => setLoggedIn(true)} />}
      </div>
      <main className="cashier-device-restriction">
        Please use a desktop or laptop to access the Cashier Dashboard.
      </main>
    </>
  )
}
