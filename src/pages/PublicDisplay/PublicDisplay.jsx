import { useEffect, useState } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import {
  displayAdvertisement,
  displayWindows,
  latestQueueNumber,
  queueEntryAccessCode,
  queueEntryDemoUrl,
} from './displayMockData'
import './PublicDisplay.css'

function formatClock(date) {
  return date.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  })
}

function WindowCard({ window }) {
  const isUnavailable = window.status !== 'Available'
  const ticketIsServing = Boolean(window.ticket)
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
          {ticketIsServing ? window.ticket : '—'}
        </strong>
      </div>
    </article>
  )
}

function PublicDisplay() {
  const [now, setNow] = useState(() => new Date())
  const [advertisementIndex, setAdvertisementIndex] = useState(0)
  const advertisement = displayAdvertisement[advertisementIndex]

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
            <div className="tv-display__system-status"><i /> DEMO DISPLAY</div>
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
              <strong>{latestQueueNumber}</strong>
            </div>
            <aside className="tv-qr-card" aria-label="Get a queue number">
              <div className="tv-qr-card__code">
                <QRCodeSVG value={queueEntryDemoUrl} size={96} level="M" includeMargin />
              </div>
              <div className="tv-qr-card__copy">
                <span>SCAN TO GET YOUR QUEUE NUMBER</span>
                <p>Can't scan? Enter this code in the QueueMate mobile app.</p>
                <strong className="tv-qr-card__manual-code">{queueEntryAccessCode}</strong>
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
              <span className="tv-queue-column__live"><i /> DEMO</span>
            </header>
            <div className="tv-queue-column__windows">
              {displayWindows.map((window) => <WindowCard key={window.number} window={window} />)}
            </div>
            <footer className="tv-queue-column__footer">
              Queue numbers reset each business day
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
