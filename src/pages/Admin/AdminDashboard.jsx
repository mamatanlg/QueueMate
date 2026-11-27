import { useCallback, useEffect, useMemo, useState } from 'react'
import { Fragment } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../../hooks/useAuth'
import './AdminDashboard.css'

const baseNavigationItems = [
  { id: 'overview', label: 'Overview' },
  { id: 'users', label: 'User Management' },
  { id: 'windows', label: 'Window Management' },
  { id: 'reports', label: 'Reports' },
]

function initials(name) {
  return name.split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase()
}

function formatUpdated(value) {
  return value ? new Date(value).toLocaleDateString() : '—'
}

function CashierEditor({
  cashier,
  staffAccounts,
  windows,
  saving,
  onCancel,
  onSave,
}) {
  const [username, setUsername] = useState(cashier?.username ?? '')
  const [displayName, setDisplayName] = useState(cashier?.displayName ?? '')
  const [password, setPassword] = useState('')
  const [windowId, setWindowId] = useState(cashier?.assignedWindow?.id ?? '')
  const [error, setError] = useState('')

  const eligibleWindows = windows.filter((window) => (
    window.id === cashier?.assignedWindow?.id
    || (window.isActive
      && (!window.assignedCashier || window.assignedCashier.id === cashier?.id))
  ))
  const inactiveHistory = new Set(
    staffAccounts
      .filter((account) => !account.isActive && account.assignedWindow)
      .map((account) => account.assignedWindow.id),
  )

  async function submit(event) {
    event.preventDefault()
    setError('')
    try {
      await onSave({
        username: username.trim(),
        displayName: displayName.trim(),
        password,
        windowId,
      }, cashier)
    } catch (saveError) {
      const duplicateUsername = staffAccounts.some((account) => (
        account.id !== cashier?.id
        && account.username.toLowerCase() === username.trim().toLowerCase()
      ))
      const historicalWindow = inactiveHistory.has(windowId)
      setError(
        saveError.status === 409 && historicalWindow && !duplicateUsername && windowId
          ? `${saveError.message} If this inactive assignment must be reused, apply migration 002 first.`
          : saveError.message,
      )
    }
  }

  return (
    <form className="admin-editor" onSubmit={submit}>
      <div className="admin-editor__heading">
        <div>
          <span className="admin-eyebrow">{cashier ? 'EDIT ACCOUNT' : 'NEW ACCOUNT'}</span>
          <h3>{cashier ? `Edit ${cashier.displayName}` : 'Create a cashier account'}</h3>
        </div>
        <button className="admin-text-button" type="button" onClick={onCancel}>Cancel</button>
      </div>
      <div className="admin-form-grid">
        <label>
          Username
          <input
            autoComplete="off"
            maxLength={100}
            minLength={3}
            onChange={(event) => setUsername(event.target.value)}
            pattern={'[A-Za-z0-9._\\-]+'}
            required
            value={username}
          />
        </label>
        <label>
          Display name
          <input
            maxLength={150}
            onChange={(event) => setDisplayName(event.target.value)}
            required
            value={displayName}
          />
        </label>
        <label>
          {cashier ? 'New password (optional)' : 'Password'}
          <input
            autoComplete="new-password"
            minLength={12}
            onChange={(event) => setPassword(event.target.value)}
            required={!cashier}
            type="password"
            value={password}
          />
          {cashier && <small>Leave blank to keep the current password.</small>}
        </label>
        {cashier && (
          <label>
            Assigned window
            <select
              onChange={(event) => setWindowId(event.target.value)}
              value={windowId}
            >
              <option value="">No window assigned</option>
              {eligibleWindows.map((window) => (
                <option key={window.id} value={window.id}>
                  Window {window.number}
                  {inactiveHistory.has(window.id) ? ' — previous inactive assignment' : ''}
                </option>
              ))}
            </select>
            {!cashier.isActive && (
              <small>Reactivate this cashier before assigning a window. An existing assignment can be released.</small>
            )}
          </label>
        )}
      </div>
      {error && <p className="admin-inline-error" role="alert">{error}</p>}
      <div className="admin-editor__actions">
        <button className="admin-button admin-button--primary" disabled={saving} type="submit">
          {saving ? 'Saving…' : cashier ? 'Save changes' : 'Create cashier'}
        </button>
      </div>
    </form>
  )
}

function WindowCard({
  window,
  cashiers,
  onAssign,
  onRelease,
  onAvailabilityChange,
  saving,
}) {
  const [staffId, setStaffId] = useState('')
  const eligibleCashiers = cashiers.filter((cashier) => cashier.isActive)

  async function submit(event) {
    event.preventDefault()
    if (!staffId) return
    await onAssign(staffId, window.id)
    setStaffId('')
  }

  return (
    <article className="admin-window-card">
      <div className="admin-window-card__top">
        <span className="admin-window-number">{String(window.number).padStart(2, '0')}</span>
        <span className={`admin-pill ${window.isActive ? 'admin-pill--active' : 'admin-pill--inactive'}`}>
          {window.isActive ? 'Active' : 'Inactive'}
        </span>
      </div>
      <h3>{window.name}</h3>
      <p className="admin-window-card__status">
        <span className={`admin-status-dot ${window.availabilityStatus === 'available' ? 'is-available' : ''}`} />
        {window.availabilityStatus === 'available' ? 'Available' : 'Unavailable'}
      </p>
      <button
        className="admin-button admin-button--secondary"
        disabled={saving}
        onClick={() => onAvailabilityChange(
          window.id,
          window.availabilityStatus === 'available' ? 'unavailable' : 'available',
        )}
        type="button"
      >
        Mark {window.availabilityStatus === 'available' ? 'unavailable' : 'available'}
      </button>
      <div className="admin-window-card__assignment">
        <span className="admin-eyebrow">ASSIGNED CASHIER</span>
        {window.assignedCashier ? (
          <div className="admin-assigned-cashier">
            <span className="admin-avatar">{initials(window.assignedCashier.displayName)}</span>
            <span><strong>{window.assignedCashier.displayName}</strong><small>@{window.assignedCashier.username}</small></span>
          </div>
        ) : (
          <p className="admin-unassigned">No active cashier assigned</p>
        )}
        {window.assignedCashier && (
          <button
            className="admin-text-button"
            disabled={saving}
            onClick={() => onRelease(window.assignedCashier.id, window.id)}
            type="button"
          >
            Release assignment
          </button>
        )}
      </div>
      {window.isActive && !window.assignedCashier && eligibleCashiers.length > 0 && (
        <form className="admin-window-assign" onSubmit={submit}>
          <label htmlFor={`window-cashier-${window.id}`}>Assign or move an active cashier</label>
          <select
            id={`window-cashier-${window.id}`}
            onChange={(event) => setStaffId(event.target.value)}
            value={staffId}
          >
            <option value="">Select cashier</option>
            {eligibleCashiers.map((cashier) => (
              <option key={cashier.id} value={cashier.id}>
                {cashier.displayName} · {cashier.assignedWindow?.name ?? 'unassigned'}
              </option>
            ))}
          </select>
          <button
            className="admin-button admin-button--secondary"
            disabled={!staffId || saving}
            type="submit"
          >
            {saving ? 'Assigning…' : 'Assign cashier'}
          </button>
        </form>
      )}
    </article>
  )
}

function ReportsPage() {
  return (
    <section className="admin-report-unavailable">
      <span className="admin-report-unavailable__mark" aria-hidden="true">—</span>
      <span className="admin-eyebrow">QUEUE REPORTS</span>
      <h2>Reporting data is not available yet</h2>
      <p>
        The backend does not currently provide ticket-history summary endpoints.
        Daily, weekly, and monthly totals, unresolved-ticket counts, and per-window
        comparisons are intentionally omitted rather than estimated from incomplete data.
      </p>
      <div className="admin-report-unavailable__list">
        <strong>Backend work needed</strong>
        <span>Authenticated report endpoints for issued, completed, skipped, and unresolved tickets.</span>
        <span>Date-range aggregation and per-window totals based on queue history.</span>
      </div>
    </section>
  )
}

export default function AdminDashboard() {
  const { session, request, signOut } = useAuth()
  const navigate = useNavigate()
  const isSystemAdmin = session.role === 'system_admin'
  const navigationItems = [
    ...baseNavigationItems,
    ...(isSystemAdmin ? [{ id: 'audit', label: 'Audit Logs' }] : []),
  ]
  const [view, setView] = useState('overview')
  const [staffAccounts, setStaffAccounts] = useState([])
  const [windows, setWindows] = useState([])
  const [auditLogs, setAuditLogs] = useState([])
  const [queueMonitor, setQueueMonitor] = useState(null)
  const [loading, setLoading] = useState(true)
  const [dataLoaded, setDataLoaded] = useState(false)
  const [saving, setSaving] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [creating, setCreating] = useState(false)
  const [busyWindowId, setBusyWindowId] = useState(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const refresh = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [staffResponse, windowResponse, auditResponse, queueResponse] = await Promise.all([
        request('/admin/staff'),
        request('/admin/windows'),
        isSystemAdmin
          ? request('/admin/audit-logs')
          : Promise.resolve({ auditLogs: [] }),
        isSystemAdmin
          ? request('/public/queue')
          : Promise.resolve(null),
      ])
      setStaffAccounts(staffResponse.staff)
      setWindows(windowResponse.windows)
      setAuditLogs(auditResponse.auditLogs)
      setQueueMonitor(queueResponse)
      setDataLoaded(true)
    } catch (loadError) {
      if (loadError.status !== 401) setError(loadError.message)
    } finally {
      setLoading(false)
    }
  }, [isSystemAdmin, request])

  useEffect(() => {
    refresh()
  }, [refresh])

  const cashiers = useMemo(
    () => staffAccounts.filter((account) => account.role === 'cashier'),
    [staffAccounts],
  )
  const activeCashiers = useMemo(
    () => cashiers.filter((cashier) => cashier.isActive).length,
    [cashiers],
  )
  const availableWindows = useMemo(
    () => windows.filter((window) => window.isActive
      && window.availabilityStatus === 'available').length,
    [windows],
  )
  const assignedWindows = useMemo(
    () => windows.filter((window) => window.assignedCashier).length,
    [windows],
  )
  const pageTitle = navigationItems.find((item) => item.id === view)?.label ?? 'Overview'

  async function saveCashier(form, cashier) {
    if (cashier && (form.windowId || null) !== (cashier.assignedWindow?.id ?? null)
      && !window.confirm(`Move ${cashier.displayName} to the selected window? Their current session will be revoked.`)) {
      return
    }

    setSaving(true)
    try {
      if (cashier) {
        const body = {
          username: form.username,
          displayName: form.displayName,
        }
        if (form.password) body.password = form.password
        if (form.windowId !== (cashier.assignedWindow?.id ?? '')) {
          body.windowId = form.windowId || null
        }
        await request(`/admin/cashiers/${cashier.id}`, { method: 'PATCH', body })
        setNotice('Cashier account updated.')
      } else {
        await request('/admin/cashiers', {
          method: 'POST',
          body: {
            username: form.username,
            displayName: form.displayName,
            password: form.password,
          },
        })
        setNotice('Cashier account created.')
      }
      setCreating(false)
      setEditingId(null)
      await refresh()
    } finally {
      setSaving(false)
    }
  }

  async function toggleCashier(cashier) {
    setSaving(true)
    setError('')
    setNotice('')
    try {
      await request(`/admin/cashiers/${cashier.id}/status`, {
        method: 'PATCH',
        body: { isActive: !cashier.isActive },
      })
      setNotice(`Cashier ${cashier.isActive ? 'deactivated' : 'activated'}.`)
      await refresh()
    } catch (actionError) {
      if (actionError.status !== 401) setError(actionError.message)
    } finally {
      setSaving(false)
    }
  }

  async function assignCashier(staffId, windowId) {
    const cashier = cashiers.find((account) => account.id === staffId)
    if (!cashier) return
    if (!window.confirm(`Move ${cashier.displayName} to this window? Their current session will be revoked.`)) {
      return
    }
    setBusyWindowId(windowId)
    setError('')
    setNotice('')
    try {
      await request(`/admin/cashiers/${staffId}`, {
        method: 'PATCH',
        body: { windowId },
      })
      setNotice(`${cashier.displayName} assigned to the selected window.`)
      await refresh()
    } catch (actionError) {
      if (actionError.status !== 401) {
        const inactiveHistory = cashiers.some((account) => (
          !account.isActive && account.assignedWindow?.id === windowId
        ))
        setError(
          actionError.status === 409 && inactiveHistory
            ? `${actionError.message} Reusing a window held by an inactive cashier requires migration 002.`
            : actionError.message,
        )
      }
    } finally {
      setBusyWindowId(null)
    }
  }

  async function releaseCashier(staffId, windowId) {
    const cashier = cashiers.find((account) => account.id === staffId)
    if (!cashier || !window.confirm(
      `Release ${cashier.displayName} from this window? This is blocked while a ticket is being served.`,
    )) {
      return
    }
    setBusyWindowId(windowId)
    setError('')
    setNotice('')
    try {
      await request(`/admin/cashiers/${staffId}`, {
        method: 'PATCH',
        body: { windowId: null },
      })
      setNotice(`${cashier.displayName} released from the window.`)
      await refresh()
    } catch (actionError) {
      if (actionError.status !== 401) setError(actionError.message)
    } finally {
      setBusyWindowId(null)
    }
  }

  async function changeWindowAvailability(windowId, availabilityStatus) {
    setBusyWindowId(windowId)
    setError('')
    setNotice('')
    try {
      await request(`/admin/windows/${windowId}/status`, {
        method: 'PATCH',
        body: { availabilityStatus },
      })
      setNotice(`Window marked ${availabilityStatus}.`)
      await refresh()
    } catch (actionError) {
      if (actionError.status !== 401) setError(actionError.message)
    } finally {
      setBusyWindowId(null)
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
    <div className="admin-desktop-shell">
      <div className="admin-desktop-interface">
        <div className="admin-app">
          <aside className="admin-sidebar">
            <Link className="admin-brand" to="/admin" aria-label="QueueMate Admin">
              <span className="admin-brand__mark">Q</span>
              <span>Queue<span>Mate</span></span>
            </Link>
            <div className="admin-sidebar__caption">ADMINISTRATION</div>
            <nav className="admin-nav" aria-label="Admin sections">
              {navigationItems.map((item) => (
                <button
                  aria-current={view === item.id ? 'page' : undefined}
                  className={`admin-nav__item ${view === item.id ? 'is-active' : ''}`}
                  key={item.id}
                  onClick={() => setView(item.id)}
                  type="button"
                >
                  <span>{item.label}</span>
                  {view === item.id && <i aria-hidden="true" />}
                </button>
              ))}
            </nav>
            <div className="admin-sidebar__spacer" />
            <div className="admin-sidebar__account">
              <span className="admin-avatar">{initials(session.profile.displayName)}</span>
              <span><strong>{session.profile.displayName}</strong><small>{isSystemAdmin ? 'System Administrator' : 'Administrator'}</small></span>
              <button className="admin-logout" onClick={logout} type="button">Sign out</button>
            </div>
          </aside>

          <main className="admin-main">
            <header className="admin-topbar">
              <div><span>QueueMate</span><b>/</b><strong>{pageTitle}</strong></div>
              <button
                className="admin-button admin-button--secondary"
                disabled={loading}
                onClick={refresh}
                type="button"
              >
                {loading ? 'Refreshing…' : 'Refresh data'}
              </button>
            </header>
            <div className="admin-content">
              <section className="admin-page-heading">
                <div>
                  <span className="admin-eyebrow">SAN ISIDRO COLLEGE · BUSINESS OFFICE</span>
                  <h1>{view === 'overview' ? `Welcome, ${session.profile.displayName}` : pageTitle}</h1>
                  <p>
                    {view === 'overview'
                      ? 'Live account and window information from the QueueMate backend.'
                      : view === 'users'
                        ? 'View staff roles and account status, and manage cashier accounts.'
                        : view === 'windows'
                          ? 'Manage availability and active cashier assignments for Windows 1–4.'
                          : 'Manage QueueMate access and counter assignments.'}
                  </p>
                </div>
                <span className="admin-live-badge"><i /> Backend data</span>
              </section>

              {error && <div className="admin-alert admin-alert--error" role="alert">{error}</div>}
              {notice && <div className="admin-alert admin-alert--success" role="status">{notice}</div>}

              {loading ? (
                <div className="admin-loading" role="status">Loading backend data…</div>
              ) : !dataLoaded ? (
                <div className="admin-loading" role="status">Backend data could not be loaded. Use Refresh data to retry.</div>
              ) : (
                <>
                  {view === 'overview' && (
                    <>
                      <section className="admin-metrics" aria-label="Account and window overview">
                        {isSystemAdmin && (
                          <>
                            <article className="admin-metric-card">
                              <span>Tickets waiting</span><strong>{queueMonitor?.waitingCount ?? '—'}</strong>
                              <small>Current business day</small>
                            </article>
                            <article className="admin-metric-card">
                              <span>Latest queue number</span><strong>{queueMonitor?.latestIssuedQueueNumber ?? '—'}</strong>
                              <small>Current business day</small>
                            </article>
                            <article className="admin-metric-card">
                              <span>Windows serving</span><strong>{queueMonitor?.windows.filter((window) => window.currentTicketNumber).length ?? '—'}</strong>
                              <small>Live queue operations</small>
                            </article>
                          </>
                        )}
                        <article className="admin-metric-card">
                          <span>Total staff accounts</span><strong>{staffAccounts.length}</strong>
                          <small>System-wide staff accounts</small>
                        </article>
                        <article className="admin-metric-card">
                          <span>Active cashiers</span><strong>{activeCashiers}</strong>
                          <small>Currently active accounts</small>
                        </article>
                        <article className="admin-metric-card">
                          <span>Available windows</span><strong>{availableWindows}</strong>
                          <small>Active windows marked available</small>
                        </article>
                        <article className="admin-metric-card">
                          <span>Assigned windows</span><strong>{assignedWindows} / 4</strong>
                          <small>Windows with an active cashier</small>
                        </article>
                      </section>
                      <section className="admin-overview-panel">
                        <div className="admin-section-heading">
                          <div><span className="admin-eyebrow">LIVE OPERATIONS</span><h2>Window status</h2></div>
                          <button className="admin-text-button" onClick={() => setView('windows')} type="button">
                            Manage windows
                          </button>
                        </div>
                        <div className="admin-overview-windows">
                          {windows.map((window) => (
                            <div className="admin-overview-window" key={window.id}>
                              <span className="admin-overview-window__number">Window {window.number}</span>
                              <strong>{window.assignedCashier?.displayName ?? 'Unassigned'}</strong>
                              <span className={`admin-window-state ${window.availabilityStatus === 'available' ? 'is-available' : ''}`}>
                                {window.availabilityStatus === 'available' ? 'Available' : 'Unavailable'}
                              </span>
                            </div>
                          ))}
                        </div>
                      </section>
                      <p className="admin-data-note">
                        Queue totals and ticket-performance statistics are not included; a reporting API is not yet available.
                      </p>
                    </>
                  )}

                  {view === 'users' && (
                    <section className="admin-panel">
                      <div className="admin-section-heading">
                        <div><span className="admin-eyebrow">STAFF ACCOUNTS</span><h2>User Management</h2></div>
                        <button
                          className="admin-button admin-button--primary"
                          onClick={() => { setCreating((current) => !current); setEditingId(null) }}
                          type="button"
                        >
                          {creating ? 'Close form' : 'Create cashier account'}
                        </button>
                      </div>
                      {creating && (
                        <CashierEditor
                          staffAccounts={staffAccounts}
                          onCancel={() => setCreating(false)}
                          onSave={saveCashier}
                          saving={saving}
                          windows={windows}
                        />
                      )}
                      <div className="admin-table-wrap">
                        <table className="admin-table">
                          <thead>
                            <tr>
                              <th>Username</th>
                              <th>Display name</th>
                              <th>Role</th>
                              <th>Window</th>
                              <th>Account status</th>
                              <th>Updated</th>
                              <th>Actions</th>
                            </tr>
                          </thead>
                          <tbody>
                            {staffAccounts.map((account) => (
                              <Fragment key={account.id}>
                                <tr>
                                  <td>@{account.username}</td>
                                  <td>{account.displayName}</td>
                                  <td>
                                    <span className={`admin-pill ${account.role === 'cashier' ? 'admin-pill--cashier' : 'admin-pill--admin'}`}>
                                      {account.role === 'system_admin'
                                        ? 'System Admin'
                                        : account.role === 'admin' ? 'Administrator' : 'Cashier'}
                                    </span>
                                  </td>
                                  <td>{account.role === 'cashier'
                                    ? account.assignedWindow?.name ?? 'Not assigned'
                                    : 'Not applicable'}</td>
                                  <td>
                                    <span className={`admin-pill ${account.isActive ? 'admin-pill--active' : 'admin-pill--inactive'}`}>
                                      {account.isActive ? 'Active' : 'Inactive'}
                                    </span>
                                  </td>
                                  <td>{formatUpdated(account.updatedAt)}</td>
                                  <td>
                                    {account.role === 'cashier' ? (
                                      <div className="admin-row-actions">
                                        <button
                                          className="admin-text-button"
                                          onClick={() => { setEditingId(editingId === account.id ? null : account.id); setCreating(false) }}
                                          type="button"
                                        >
                                          {editingId === account.id ? 'Close' : 'Edit'}
                                        </button>
                                        <button
                                          className="admin-text-button"
                                          disabled={saving}
                                          onClick={() => toggleCashier(account)}
                                          type="button"
                                        >
                                          {account.isActive ? 'Deactivate' : 'Activate'}
                                        </button>
                                      </div>
                                    ) : <span className="admin-muted">Managed separately</span>}
                                  </td>
                                </tr>
                                {account.role === 'cashier' && editingId === account.id && (
                                  <tr key={`${account.id}-editor`}>
                                    <td colSpan="7">
                                      <CashierEditor
                                        cashier={account}
                                        staffAccounts={staffAccounts}
                                        onCancel={() => setEditingId(null)}
                                        onSave={saveCashier}
                                        saving={saving}
                                        windows={windows}
                                      />
                                    </td>
                                  </tr>
                                )}
                              </Fragment>
                            ))}
                          </tbody>
                        </table>
                        {staffAccounts.length === 0 && <p className="admin-empty">No staff accounts were returned.</p>}
                      </div>
                    </section>
                  )}

                  {view === 'windows' && (
                    <section>
                      <div className="admin-section-heading admin-section-heading--standalone">
                        <div><span className="admin-eyebrow">FOUR COUNTERS</span><h2>Window Management</h2></div>
                      </div>
                      <p className="admin-data-note">
                        Set window availability and manage cashier assignments independently. Reassigning an active cashier revokes that cashier’s current sessions.
                      </p>
                      <div className="admin-window-grid">
                        {windows.map((window) => (
                          <WindowCard
                            cashiers={cashiers}
                            key={window.id}
                            onAssign={assignCashier}
                            onRelease={releaseCashier}
                            onAvailabilityChange={changeWindowAvailability}
                            saving={busyWindowId === window.id}
                            window={window}
                          />
                        ))}
                      </div>
                    </section>
                  )}

                  {view === 'reports' && <ReportsPage />}

                  {view === 'audit' && isSystemAdmin && (
                    <section className="admin-panel">
                      <div className="admin-section-heading">
                        <div>
                          <span className="admin-eyebrow">APPEND-ONLY ACTIVITY RECORDS</span>
                          <h2>Audit Logs</h2>
                        </div>
                      </div>
                      <div className="admin-table-wrap">
                        <table className="admin-table">
                          <thead>
                            <tr>
                              <th>Timestamp</th>
                              <th>Actor</th>
                              <th>Action</th>
                              <th>Affected record</th>
                              <th>Details</th>
                            </tr>
                          </thead>
                          <tbody>
                            {auditLogs.map((entry) => (
                              <tr key={entry.id}>
                                <td>{new Date(entry.timestamp).toLocaleString()}</td>
                                <td>{entry.actor
                                  ? `${entry.actor.username} (${entry.actor.role})`
                                  : 'Public / unknown'}</td>
                                <td>{entry.action}</td>
                                <td>{entry.affectedRecord
                                  ? `${entry.affectedRecord.table} · ${entry.affectedRecord.id}`
                                  : '—'}</td>
                                <td><code>{JSON.stringify(entry.details)}</code></td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        {auditLogs.length === 0 && (
                          <p className="admin-empty">No audit records have been recorded.</p>
                        )}
                      </div>
                    </section>
                  )}
                </>
              )}
            </div>
          </main>
        </div>
      </div>
      <main className="admin-device-restriction">
        QueueMate administration is available on a desktop or laptop screen.
      </main>
    </div>
  )
}
