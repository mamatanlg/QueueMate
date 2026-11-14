import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../../hooks/useAuth'
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
    timeZone: 'Asia/Manila',
  })
}

function formatBusinessDate(value) {
  if (!value) return 'Loading business date…'
  return new Date(`${value}T00:00:00+08:00`).toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'Asia/Manila',
  })
}

function LoginScreen({ onLogin, sessionNotice }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)
  const location = useLocation()

  async function handleSubmit(event) {
    event.preventDefault()
    setError('')
    setPending(true)
    try {
      await onLogin(username, password)
      setPassword('')
    } catch (loginError) {
      setError(loginError.status === 401
        ? 'Username or password is incorrect, or this account is inactive.'
        : loginError.status === 429
          ? 'Too many sign-in attempts. Please wait before trying again.'
          : loginError.message)
    } finally {
      setPending(false)
    }
  }

  return (
    <main className="cashier-login">
      <section className="cashier-login__brand">
        <Link className="cashier-brand" to="/cashier" aria-label="QueueMate home">
          <span className="cashier-brand__mark">Q</span>
          <span>Queue<span>Mate</span></span>
        </Link>
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
          <p className="cashier-login__subheading">Sign in to open your authorized workspace.</p>

          {(location.state?.notice || sessionNotice) && (
            <p className="cashier-form__notice" role="status">{location.state?.notice || sessionNotice}</p>
          )}

          <form className="cashier-form" onSubmit={handleSubmit}>
            <label htmlFor="cashier-username">Username</label>
            <input
              id="cashier-username"
              autoComplete="username"
              required
              value={username}
              onChange={(event) => setUsername(event.target.value)}
            />
            <label htmlFor="cashier-password">Password</label>
            <input
              id="cashier-password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
            {error && <p className="cashier-form__error" role="alert">{error}</p>}
            <button
              className="cashier-button cashier-button--primary cashier-form__submit"
              disabled={pending}
              type="submit"
            >
              {pending ? 'Signing in…' : 'Sign in'} <Icon name="arrow" size={17} />
            </button>
          </form>

          <p className="cashier-login__footnote">For authorized QueueMate cashiers and administrators.</p>
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

function CashierDashboard() {
  const { session, request, signOut } = useAuth()
  const navigate = useNavigate()
  const [account, setAccount] = useState(null)
  const [waiting, setWaiting] = useState([])
  const [activity, setActivity] = useState([])
  const [view, setView] = useState('counter')
  const [loading, setLoading] = useState(true)
  const [dataLoaded, setDataLoaded] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [now, setNow] = useState(() => new Date())

  const refresh = useCallback(async (showLoading = true) => {
    if (showLoading) setLoading(true)
    setError('')
    try {
      const [currentAccount, queue] = await Promise.all([
        request('/cashier/me'),
        request('/cashier/queue'),
      ])
      setAccount(currentAccount)
      setWaiting(queue.tickets.map((ticket) => ({
        id: `${ticket.businessDate}-${ticket.ticketNumber}`,
        number: ticket.ticketNumber,
        type: ticket.transactionType,
        businessDate: ticket.businessDate,
        issuedAt: formatClock(new Date(ticket.issuedAt)),
      })))
      setDataLoaded(true)
      setNow(new Date())
    } catch (loadError) {
      if (loadError.status !== 401) setError(loadError.message)
    } finally {
      if (showLoading) setLoading(false)
    }
  }, [request])

  useEffect(() => {
    refresh()
    const poller = window.setInterval(() => refresh(false), 15000)
    const clock = window.setInterval(() => setNow(new Date()), 30000)
    return () => {
      window.clearInterval(poller)
      window.clearInterval(clock)
    }
  }, [refresh])

  const windowInfo = account?.window
  const cashier = account?.cashier ?? session.profile
  const available = windowInfo?.status === 'available'
  const currentTicket = windowInfo?.currentTicketNumber
    ? {
        number: windowInfo.currentTicketNumber,
        type: windowInfo.currentTransactionType ?? 'Transaction',
      }
    : null
  const currentTicketIsToday = Boolean(
    currentTicket
    && windowInfo.currentTicketBusinessDate
    && windowInfo.currentTicketBusinessDate === windowInfo.businessDate,
  )
  const previousDateTicket = Boolean(currentTicket && !currentTicketIsToday)
  const dateLabel = useMemo(
    () => formatBusinessDate(windowInfo?.businessDate),
    [windowInfo?.businessDate],
  )
  const pageTitle = navigationItems.find((item) => item.id === view)?.label ?? 'Active Counter'

  function recordActivity(action, ticket) {
    const item = {
      id: `${Date.now()}-${ticket.number}`,
      action,
      number: ticket.number,
      type: ticket.type,
      time: formatClock(new Date()),
    }
    setActivity((items) => [item, ...items])
    setNotice(`Ticket ${ticket.number} ${action.toLowerCase()}.`)
    window.setTimeout(() => setNotice(''), 3200)
  }

  async function runTicketAction(path, action) {
    setPending(true)
    setError('')
    try {
      const result = await request(path, { method: 'POST' })
      recordActivity(action, {
        number: result.ticketNumber,
        type: result.transactionType ?? currentTicket?.type ?? 'Transaction',
      })
      await refresh(false)
    } catch (actionError) {
      if (actionError.status !== 401) setError(actionError.message)
    } finally {
      setPending(false)
    }
  }

  async function changeAvailability(nextAvailable) {
    setPending(true)
    setError('')
    try {
      const result = await request('/cashier/window/status', {
        method: 'PATCH',
        body: { availabilityStatus: nextAvailable ? 'available' : 'unavailable' },
      })
      setNotice(`Window marked ${result.status}.`)
      await refresh(false)
    } catch (actionError) {
      if (actionError.status !== 401) setError(actionError.message)
    } finally {
      setPending(false)
    }
  }

  async function logout() {
    let message = ''
    try {
      await signOut()
    } catch {
      message = 'Signed out on this device, but the backend could not confirm revocation. The token will expire automatically.'
    }
    navigate('/cashier', {
      replace: true,
      state: message ? { notice: message } : undefined,
    })
  }

  return (
    <div className="cashier-app">
      <aside className="cashier-sidebar">
        <Link className="cashier-brand cashier-brand--sidebar" to="/cashier" aria-label="QueueMate">
          <span className="cashier-brand__mark">Q</span>
          <span>Queue<span>Mate</span></span>
        </Link>
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
              {item.id === 'queue' && <span className="cashier-nav__count">{dataLoaded ? waiting.length : '—'}</span>}
            </button>
          ))}
        </nav>
        <div className="cashier-sidebar__spacer" />
        <div className="cashier-sidebar__counter">
          <span className="cashier-sidebar__counter-icon"><Icon name="window" size={18} /></span>
          <div><small>YOUR COUNTER</small><strong>{windowInfo?.name ?? 'Loading…'}</strong></div>
          <span className={`cashier-status-dot ${available ? 'is-available' : ''}`} />
        </div>
        <div className="cashier-sidebar__profile">
          <span className="cashier-avatar">{initials(cashier?.displayName ?? '')}</span>
          <span className="cashier-sidebar__profile-name">
            <strong>{cashier?.displayName ?? 'Cashier'}</strong><small>Cashier</small>
          </span>
          <button className="cashier-icon-button" type="button" onClick={logout} aria-label="Log out" title="Log out">
            <Icon name="logout" size={17} />
          </button>
        </div>
      </aside>

      <main className="cashier-main">
        <header className="cashier-topbar">
          <div className="cashier-topbar__crumb"><span>Cashier workspace</span><Icon name="chevron" size={14} /><strong>{pageTitle}</strong></div>
          <div className="cashier-topbar__right">
            <span className="cashier-preview-label cashier-live-label"><span /> Live backend</span>
            <button
              type="button"
              className="cashier-icon-button cashier-notification-button"
              onClick={() => refresh()}
              aria-label="Refresh cashier data"
              title="Refresh"
            >
              <Icon name="arrow" size={18} />
            </button>
            <div className="cashier-topbar__date"><strong>{formatClock(now)}</strong><span>{dateLabel}</span></div>
          </div>
        </header>

        <div className="cashier-content">
          <section className="cashier-page-heading">
            <div>
              <span className="cashier-eyebrow cashier-eyebrow--light">SAN ISIDRO COLLEGE · BUSINESS OFFICE</span>
              <h1>{view === 'counter' ? `Welcome, ${cashier?.displayName ?? 'Cashier'}` : pageTitle}</h1>
              <p>{view === 'counter' ? 'Live information for your assigned window.' : `${pageTitle} from the QueueMate backend.`}</p>
            </div>
            <div className="cashier-date-chip"><Icon name="clock" size={16} /><span>{dateLabel}</span></div>
          </section>

          {error && <div className="cashier-api-error" role="alert">{error}</div>}
          {loading && <div className="cashier-api-loading" role="status">Connecting to the QueueMate backend…</div>}
          {!loading && !dataLoaded && (
            <div className="cashier-api-loading" role="status">
              Live cashier data is unavailable. Use Refresh to try again.
            </div>
          )}

          {dataLoaded && view === 'counter' && (
            <>
              <section className="cashier-window-panel">
                <div className="cashier-window-panel__identity">
                  <span className="cashier-window-panel__icon"><Icon name="window" size={20} /></span>
                  <div><span>ASSIGNED WINDOW</span><strong>{windowInfo?.name ?? 'Loading…'}</strong></div>
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
                    disabled={pending || !windowInfo}
                    type="button"
                    aria-pressed={available}
                  >
                    <span /> Available
                  </button>
                  <button
                    className={`cashier-availability-button ${!available ? 'is-selected is-unavailable' : ''}`}
                    onClick={() => changeAvailability(false)}
                    disabled={pending || !windowInfo}
                    type="button"
                    aria-pressed={!available}
                  >
                    <span /> Unavailable
                  </button>
                </div>
              </section>

              <section className="cashier-stats-grid" aria-label="Available queue statistics">
                <StatCard label="Waiting today" value={waiting.length} note="live backend queue" tone="queue" />
                <StatCard label="Completed today" value="—" note="reporting API unavailable" tone="complete" />
                <StatCard label="Skipped today" value="—" note="reporting API unavailable" tone="skip" />
                <StatCard label="Tickets served" value="—" note="reporting API unavailable" tone="served" />
              </section>

              <div className="cashier-work-grid">
                <section className="cashier-current-card">
                  <div className="cashier-card-heading">
                    <div>
                      <span className="cashier-eyebrow cashier-eyebrow--light">
                        {previousDateTicket ? 'UNRESOLVED PRIOR-DAY TICKET' : 'NOW SERVING'}
                      </span>
                      <h2>Current ticket</h2>
                    </div>
                    <span className={`cashier-serving-badge ${currentTicket ? '' : 'is-idle'}`}><i />{currentTicket ? 'In service' : 'Ready for next'}</span>
                  </div>
                  {currentTicket ? (
                    <>
                      <div className="cashier-ticket-display">
                        <div className="cashier-ticket-display__number">{currentTicket.number}</div>
                        <span className={`cashier-type-pill cashier-type-pill--large ${currentTicket.type === 'SOA' ? 'cashier-type-pill--blue' : currentTicket.type === 'Payment' ? 'cashier-type-pill--teal' : 'cashier-type-pill--violet'}`}>
                          {currentTicket.type}
                        </span>
                        <span className="cashier-ticket-display__called">
                          {previousDateTicket
                            ? `Business date ${windowInfo.currentTicketBusinessDate}`
                            : 'Currently assigned to this window'}
                        </span>
                      </div>
                      {previousDateTicket ? (
                        <p className="cashier-action-hint cashier-stale-ticket-warning">
                          This ticket is not from today. Its status cannot be changed here; request an administrator to resolve it.
                        </p>
                      ) : (
                        <div className="cashier-current-actions">
                          <button
                            className="cashier-button cashier-button--complete"
                            type="button"
                            onClick={() => runTicketAction('/cashier/current/complete', 'Completed')}
                            disabled={pending || !currentTicketIsToday}
                          >
                            <Icon name="check" size={18} /> Complete
                          </button>
                          <button
                            className="cashier-button cashier-button--skip"
                            type="button"
                            onClick={() => runTicketAction('/cashier/current/skip', 'Skipped')}
                            disabled={pending || !currentTicketIsToday}
                          >
                            Skip ticket
                          </button>
                        </div>
                      )}
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
                    onClick={() => runTicketAction('/cashier/queue/next', 'Called')}
                    disabled={!available || Boolean(currentTicket) || waiting.length === 0 || pending || loading}
                  >
                    <Icon name="arrow" size={18} /> Call next ticket
                  </button>
                  {!available && <p className="cashier-action-hint">Mark this window available before calling the next ticket.</p>}
                  {available && !currentTicket && waiting.length === 0 && <p className="cashier-action-hint">There are no waiting tickets today.</p>}
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
                    <div className="cashier-empty-list">{loading ? 'Loading queue…' : 'The waiting queue is clear.'}</div>
                  )}
                  <div className="cashier-queue-foot"><span><span className="cashier-queue-foot__dot cashier-queue-foot__dot--live" /> Synced with backend every 15 seconds</span><span>Oldest first</span></div>
                </section>
              </div>
            </>
          )}

          {dataLoaded && view === 'queue' && (
            <section className="cashier-list-page">
              <div className="cashier-list-page__summary"><strong>{waiting.length} tickets waiting today</strong><span>Live backend data · call order</span></div>
              {waiting.length ? (
                <div className="cashier-queue-list cashier-queue-list--full">
                  {waiting.map((ticket, index) => <TicketRow key={ticket.id} ticket={ticket} position={index + 1} />)}
                </div>
              ) : <div className="cashier-empty-list">{loading ? 'Loading queue…' : 'The waiting queue is clear.'}</div>}
              <button className="cashier-button cashier-button--primary cashier-list-page__action" type="button" onClick={() => setView('counter')}>Back to active counter</button>
            </section>
          )}

          {dataLoaded && view === 'activity' && (
            <section className="cashier-list-page">
              <div className="cashier-list-page__summary"><strong>Actions this session</strong><span>Successful actions recorded by this screen; server history is not available.</span></div>
              {activity.length ? (
                <div className="cashier-activity-list">
                  {activity.map((item) => (
                    <article className="cashier-activity-row" key={item.id}>
                      <span className={`cashier-activity-row__icon ${item.action === 'Completed' ? 'is-completed' : item.action === 'Skipped' ? 'is-skipped' : ''}`}>
                        <Icon name={item.action === 'Completed' ? 'check' : item.action === 'Skipped' ? 'arrow' : 'counter'} size={17} />
                      </span>
                      <div className="cashier-activity-row__description"><strong>{item.action} ticket {item.number}</strong><span>{item.type} · {windowInfo?.name ?? 'Assigned window'}</span></div>
                      <time>{item.time}</time>
                    </article>
                  ))}
                </div>
              ) : (
                <div className="cashier-empty-list">No actions have been completed in this browser session.</div>
              )}
              <button className="cashier-button cashier-button--primary cashier-list-page__action" type="button" onClick={() => setView('counter')}>Back to active counter</button>
            </section>
          )}

          <footer className="cashier-footer"><span>QueueMate <b>·</b> Cashier workspace</span><span>Connected to backend</span></footer>
        </div>
      </main>
      {notice && <div className="cashier-toast" role="status"><span><Icon name="check" size={16} /></span>{notice}</div>}
    </div>
  )
}

function initials(name) {
  return name.split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase()
}

export default function Cashier() {
  const { session, sessionNotice, signIn } = useAuth()
  const navigate = useNavigate()

  if (session?.role === 'admin') return <Navigate to="/admin" replace />
  if (session?.role === 'cashier') return <CashierDashboard />

  async function login(username, password) {
    const signedIn = await signIn(username, password)
    navigate(signedIn.role === 'admin' ? '/admin' : '/cashier', { replace: true })
  }

  return (
    <>
      <div className="cashier-desktop-interface">
        <LoginScreen onLogin={login} sessionNotice={sessionNotice} />
      </div>
      <main className="cashier-device-restriction">
        Please use a desktop or laptop to access the Cashier Dashboard.
      </main>
    </>
  )
}
