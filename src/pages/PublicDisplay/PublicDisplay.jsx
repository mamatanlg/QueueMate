import { useEffect, useRef, useState } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { io } from 'socket.io-client'
import { apiRequest } from '../../services/api'
import { QUEUE_ENTRY_QR_PAYLOAD } from '../../../mobile-app/queue-entry-qr.mjs'
import { displayAdvertisement } from './displayMockData'
import './PublicDisplay.css'

const queueEvents = [
  'ticket:issued',
  'ticket:called',
  'ticket:completed',
  'ticket:skipped',
  'window:updated',
  'notification:created',
]

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL || '/api/v1'

function formatClock(date) {
  return date.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  })
}

function WindowCard({ window }) {
  const isUnavailable = window.status !== 'available'
  const ticketIsServing = Boolean(window.currentTicketNumber)
  const stateLabel = ticketIsServing ? 'SERVING' : isUnavailable ? 'UNAVAILABLE' : 'AVAILABLE'
  const cardState = ticketIsServing ? 'serving' : isUnavailable ? 'unavailable' : 'available'

  return (
    <article className={`tv-window-card tv-window-card--${cardState}`}>
      <div className="tv-window-card__heading">
        <h2>WINDOW {window.number}</h2>
        <span className="tv-window-card__state">{stateLabel}</span>
      </div>
      <div className="tv-window-card__details">
        <strong className={ticketIsServing ? '' : 'tv-window-card__idle'}>
          {ticketIsServing ? window.currentTicketNumber : '—'}
        </strong>
      </div>
    </article>
  )
}

function PublicDisplay() {
  const [now, setNow] = useState(() => new Date())
  const [advertisementIndex, setAdvertisementIndex] = useState(0)
  const [queue, setQueue] = useState(null)
  const [queueLoading, setQueueLoading] = useState(true)
  const [queueError, setQueueError] = useState('')
  const [socketConnected, setSocketConnected] = useState(false)
  const refreshQueueRef = useRef(null)
  const advertisement = displayAdvertisement[advertisementIndex]
  const hasServingTicket = queue?.windows.some((queueWindow) => (
    Boolean(queueWindow.currentTicketNumber)
  ))
  const statusLabel = queueError
    ? queue ? 'STALE DATA' : 'DATA ERROR'
    : socketConnected && queue ? 'LIVE' : 'CONNECTING'

  useEffect(() => {
    let active = true
    let latestRequestId = 0

    async function refreshQueue() {
      const requestId = ++latestRequestId
      try {
        const response = await apiRequest('/public/queue')
        if (!active || requestId !== latestRequestId) return
        setQueue(response)
        setQueueError('')
      } catch (error) {
        if (!active || requestId !== latestRequestId) return
        setQueueError(error instanceof Error
          ? error.message
          : 'Unable to load the public queue.')
      } finally {
        if (active && requestId === latestRequestId) setQueueLoading(false)
      }
    }

    refreshQueueRef.current = refreshQueue
    void refreshQueue()

    const socketOrigin = new URL(apiBaseUrl, window.location.origin).origin
    const socket = io(socketOrigin)
    const handleConnect = () => {
      setSocketConnected(true)
      void refreshQueue()
    }
    const handleDisconnect = () => setSocketConnected(false)

    socket.on('connect', handleConnect)
    socket.on('disconnect', handleDisconnect)
    socket.on('connect_error', handleDisconnect)
    for (const event of queueEvents) socket.on(event, refreshQueue)

    return () => {
      active = false
      refreshQueueRef.current = null
      socket.disconnect()
    }
  }, [])

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    if (displayAdvertisement.length < 2) return undefined

    const timer = window.setInterval(() => {
      setAdvertisementIndex((index) => (index + 1) % displayAdvertisement.length)
    }, 12000)
    return () => window.clearInterval(timer)
  }, [])

  return (
    <>
      <main className="tv-display">
        <header className="tv-display__header">
          <a className="tv-display__brand" href="/display" aria-label="QueueMate public display">
            <span className="tv-display__brand-mark">Q</span>
            <span>Queue<span>Mate</span></span>
          </a>
          <div className="tv-display__location">
            <span className="tv-display__school">SAN ISIDRO COLLEGE</span>
            <span className="tv-display__business-office">BUSINESS OFFICE</span>
          </div>
          <div className="tv-display__header-right">
            <div className="tv-display__system-status"><i /> {statusLabel}</div>
            <div className="tv-display__datetime">
              <strong>{formatClock(now)}</strong>
              <span>{now.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}</span>
            </div>
          </div>
        </header>

        <div className="tv-display__layout">
          <section className="tv-advertisement" aria-label="Campus advertisement preview">
            <div className="tv-advertisement__image">
              <img src={advertisement.image} alt="" />
            </div>
            <div className="tv-advertisement__shade" />
            <div className="tv-advertisement__copy">
              <span className="tv-display__eyebrow">{advertisement.eyebrow}</span>
              <h1>{advertisement.title}</h1>
              <p>{advertisement.description}</p>
              <span className="tv-advertisement__placeholder">{advertisement.note}</span>
            </div>
            <div className="tv-advertisement__latest">
              <span>LATEST QUEUE NUMBER</span>
              <strong>{queue?.latestIssuedQueueNumber ?? '—'}</strong>
            </div>
            <aside className="tv-qr-card" aria-label="QueueMate official queue-entry QR code">
              <div className="tv-qr-card__code">
                <QRCodeSVG value={QUEUE_ENTRY_QR_PAYLOAD} size={96} level="M" includeMargin />
              </div>
              <div className="tv-qr-card__copy">
                <span>SCAN TO START QUEUE ENTRY</span>
                <p>Or enter this official flow identifier in the student app:</p>
                <code className="tv-qr-card__manual-code">{QUEUE_ENTRY_QR_PAYLOAD}</code>
              </div>
            </aside>
            {displayAdvertisement.length > 1 && (
              <div className="tv-advertisement__pagination" aria-label="Advertisement slides">
                {displayAdvertisement.map((slide, index) => (
                  <span
                    className={index === advertisementIndex ? 'is-active' : ''}
                    key={slide.title}
                  />
                ))}
              </div>
            )}
          </section>

          <section className="tv-queue-column" aria-label="Cashier windows and serving tickets">
            <header className="tv-queue-column__heading">
              <div>
                <span className="tv-display__eyebrow">BUSINESS OFFICE</span>
                <h1>Now Serving</h1>
              </div>
              <span className={`tv-queue-column__live ${socketConnected ? 'is-connected' : 'is-disconnected'}`}>
                <i /> {socketConnected ? 'LIVE UPDATES' : 'RECONNECTING'}
              </span>
            </header>
            {queueError && queue && (
              <div className="tv-display__connection-message" role="status">
                Live queue refresh failed: {queueError}. Showing the last loaded data.
                <button type="button" onClick={() => void refreshQueueRef.current?.()}>
                  Retry
                </button>
              </div>
            )}
            {queueLoading && !queue && (
              <div className="tv-display__queue-state" role="status">
                Connecting to the live queue…
              </div>
            )}
            {!queueLoading && !queue && (
              <div className="tv-display__queue-state" role="alert">
                <strong>Queue data is unavailable.</strong>
                <span>{queueError}</span>
                <button type="button" onClick={() => void refreshQueueRef.current?.()}>
                  Retry connection
                </button>
              </div>
            )}
            {queue && queue.windows.length === 0 && (
              <div className="tv-display__queue-state" role="status">
                No cashier windows are configured.
              </div>
            )}
            {queue && queue.windows.length > 0 && (
              <div className="tv-queue-column__windows">
                {queue.windows.map((queueWindow) => (
                  <WindowCard key={queueWindow.windowNumber} window={{
                    number: queueWindow.windowNumber,
                    status: queueWindow.status,
                    currentTicketNumber: queueWindow.currentTicketNumber,
                  }} />
                ))}
              </div>
            )}
            <footer className="tv-queue-column__footer">
              {queue && queue.waitingCount === 0 && !hasServingTicket
                ? 'No active queue tickets · Queue numbers reset each business day'
                : queue
                  ? `${queue.waitingCount} waiting · Queue numbers reset each business day`
                  : 'Queue numbers reset each business day'}
            </footer>
          </section>
        </div>
      </main>
      <main className="tv-display-restriction">
        This display is intended for a PC connected to a TV.
      </main>
    </>
  )
}

export default PublicDisplay
