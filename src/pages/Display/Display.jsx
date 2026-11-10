import { useEffect, useState, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useSocket } from '../../context/SocketContext'
import NumberDisplay from '../../components/NumberDisplay'
import VoiceAnnouncer from '../../components/VoiceAnnouncer'
import { padNumber, formatTicket } from '../../utils/formatters'
import { t } from '../../utils/i18n'
import { primeAudio } from '../../utils/sounds'
import './Display.css'

const WMO_ICONS = {
  0: '☀️', 1: '🌤', 2: '⛅', 3: '☁️',
  45: '🌫', 48: '🌫',
  51: '🌦', 53: '🌦', 55: '🌧',
  61: '🌧', 63: '🌧', 65: '🌧',
  71: '🌨', 73: '🌨', 75: '❄️',
  80: '🌦', 81: '🌧', 82: '⛈',
  95: '⛈', 96: '⛈', 99: '⛈',
}

function useWeather() {
  const [weather, setWeather] = useState(null)

  useEffect(() => {
    let cancelled = false

    async function fetchWeather(lat, lon) {
      try {
        const res = await fetch(
          `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,weather_code&timezone=auto`
        )
        const data = await res.json()
        if (!cancelled && data.current) {
          setWeather({
            temp: Math.round(data.current.temperature_2m),
            unit: data.current_units?.temperature_2m || '°C',
            code: data.current.weather_code,
            icon: WMO_ICONS[data.current.weather_code] || '🌡',
          })
        }
      } catch {}
    }

    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => fetchWeather(pos.coords.latitude, pos.coords.longitude),
        () => {} // silently fail if denied
      )
    }

    // Refresh every 10 minutes
    const interval = setInterval(() => {
      if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
          (pos) => fetchWeather(pos.coords.latitude, pos.coords.longitude),
          () => {}
        )
      }
    }, 600000)

    return () => { cancelled = true; clearInterval(interval) }
  }, [])

  return weather
}

export default function Display() {
  const { state } = useSocket()
  const [clock, setClock] = useState(new Date())
  const [isFs, setIsFs] = useState(false)
  const [signageMode, setSignageMode] = useState(false)
  const [slideIdx, setSlideIdx] = useState(0)
  const [audioLocked, setAudioLocked] = useState(false)
  const weather = useWeather()
  const lang = state.settings.uiLang || 'en'
  const slides = state.settings.mediaSlides || []
  const layout = state.settings.displayLayout || 'classic'

  useEffect(() => {
    const i = setInterval(() => setClock(new Date()), 1000)
    return () => clearInterval(i)
  }, [])

  // Browsers block audio until the user has interacted with the tab. Show a
  // one-shot "click to enable sound" banner so the operator knows why the
  // first call was silent — clicking primes the audio pipeline so subsequent
  // ticket announcements actually play.
  useEffect(() => {
    primeAudio()
    try {
      const probe = new (window.AudioContext || window.webkitAudioContext)()
      if (probe.state === 'suspended') setAudioLocked(true)
      probe.close().catch(() => {})
    } catch {}
    const unlock = () => setAudioLocked(false)
    window.addEventListener('click', unlock, { once: true })
    window.addEventListener('keydown', unlock, { once: true })
    window.addEventListener('touchstart', unlock, { once: true })
    return () => {
      window.removeEventListener('click', unlock)
      window.removeEventListener('keydown', unlock)
      window.removeEventListener('touchstart', unlock)
    }
  }, [])

  // Signage rotation: alternate between queue and slides
  useEffect(() => {
    if (slides.length === 0) { setSignageMode(false); return }
    const interval = (state.settings.signageInterval || 10) * 1000
    const timer = setInterval(() => {
      setSignageMode(prev => {
        if (prev) {
          setSlideIdx(i => (i + 1) % slides.length)
          return false // switch back to queue
        }
        return true // switch to signage
      })
    }, interval)
    return () => clearInterval(timer)
  }, [slides.length, state.settings.signageInterval])

  const toggleFs = async () => {
    const el = document.documentElement
    try {
      if (!document.fullscreenElement) {
        if (el.requestFullscreen) await el.requestFullscreen()
        else if (el.webkitRequestFullscreen) await el.webkitRequestFullscreen()
        else if (el.msRequestFullscreen) await el.msRequestFullscreen()
        if ('wakeLock' in navigator) { try { await navigator.wakeLock.request('screen') } catch {} }
      } else {
        if (document.exitFullscreen) await document.exitFullscreen()
        else if (document.webkitExitFullscreen) await document.webkitExitFullscreen()
      }
    } catch {}
  }

  useEffect(() => {
    const h = () => setIsFs(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', h)
    document.addEventListener('webkitfullscreenchange', h)
    return () => { document.removeEventListener('fullscreenchange', h); document.removeEventListener('webkitfullscreenchange', h) }
  }, [])

  // Sanitize counter.currentTicket: it must point to a ticket that's actually
  // serving at this counter, otherwise the layouts would render the same ticket
  // both as "now serving" and as "waiting" when state desyncs (e.g. after a
  // transfer that didn't fully clear the source counter).
  const activeCounters = state.counters
    .filter(c => c.status === 'open')
    .map(c => {
      if (!c.currentTicket) return c
      const t = state.tickets.find(t => t.number === c.currentTicket)
      if (!t || t.status !== 'serving' || t.counterId !== c.id) {
        return { ...c, currentTicket: null }
      }
      return c
    })
  const allClosed = activeCounters.length === 0
  const waitingTickets = state.tickets.filter(t => t.status === 'waiting').sort((a, b) => a.number - b.number)
  const servedTickets = state.tickets.filter(t => t.status === 'served').sort((a, b) => b.completedAt - a.completedAt)
  const totalWaiting = waitingTickets.length

  const clockStr = clock.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true })
  const dateStr = clock.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })

  return (
    <div className="dsp">
      <VoiceAnnouncer />
      <div className="dsp-bg" />

      {audioLocked && (
        <div
          onClick={() => setAudioLocked(false)}
          style={{
            position: 'fixed', inset: 0, zIndex: 9999,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'rgba(0,0,0,0.55)', cursor: 'pointer',
          }}
        >
          <div style={{
            background: 'var(--bg-raised)', padding: '32px 40px', borderRadius: 16,
            border: '1px solid var(--border)', textAlign: 'center', maxWidth: 380,
          }}>
            <div style={{ fontSize: 36, marginBottom: 12 }}>🔊</div>
            <h2 style={{ fontSize: 18, fontWeight: 700, color: 'var(--white)', marginBottom: 8 }}>
              Click to enable sound
            </h2>
            <p style={{ fontSize: 13, color: 'var(--gray-2)', lineHeight: 1.5 }}>
              Browsers block audio until you interact with the page. Click anywhere
              to start hearing chime and voice announcements.
            </p>
          </div>
        </div>
      )}

      {/* Logo */}
      {state.settings.logoUrl && (
        <img src={state.settings.logoUrl} className="dsp-logo" alt="" />
      )}

      {/* Announcement banner — scrolls right-off-screen → left-off-screen.
          Previously the JSX duplicated each item to fake a seamless loop, but
          for a short single announcement that looked like double text with
          two bullets. CSS now scrolls a single pass spanning the full screen. */}
      {state.announcements.length > 0 && (
        <div className="dsp-banner">
          <div className="dsp-banner-track">
            {state.announcements.map((a, i) => (
              <span key={i} className="dsp-banner-item">{a}</span>
            ))}
          </div>
        </div>
      )}


      {/* Digital signage overlay */}
      <AnimatePresence>
        {signageMode && slides.length > 0 && (
          <motion.div
            className="dsp-signage"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.8 }}
          >
            {slides[slideIdx]?.match(/\.(mp4|webm|ogg)(\?|$)/i) ? (
              <video src={slides[slideIdx]} className="dsp-signage-media" autoPlay muted loop />
            ) : (
              <img src={slides[slideIdx]} className="dsp-signage-media" alt="" />
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {allClosed ? (
        <div className="dsp-closed-wrap">
          <div className="dsp-closed-line" />
          <h1 className="dsp-closed-en">{t('serviceClosed', lang)}</h1>
          {lang !== 'ar' && <p className="dsp-closed-ar ar">{t('serviceClosed', 'ar')}</p>}
          <div className="dsp-closed-line" />
        </div>
      ) : (
        <div className="dsp-content">
          {/* Layout: Classic */}
          {layout === 'classic' && (
            <div className={`dsp-grid dsp-grid--${activeCounters.length > 12 ? 'many' : activeCounters.length}`}>
              {activeCounters.map(counter => {
                const ticket = counter.currentTicket ? state.tickets.find(t => t.number === counter.currentTicket) : null
                const cat = ticket ? state.categories.find(c => c.id === ticket.categoryId) : null
                return (
                  <motion.div key={counter.id} className="dsp-counter" layout>
                    <div className="dsp-counter-head">
                      <span className="dsp-counter-name">{counter.name}</span>
                      {counter.operatorName && <span className="dsp-counter-op">{counter.operatorName}</span>}
                    </div>
                    <div className="dsp-counter-num">
                      <AnimatePresence mode="wait">
                        {ticket ? (
                          <motion.div key={ticket.number} className="dsp-num-animate"
                            initial={{ scale: 0.3, opacity: 0, rotateX: -60 }}
                            animate={{ scale: 1, opacity: 1, rotateX: 0 }}
                            exit={{ scale: 1.3, opacity: 0, rotateX: 30, filter: 'blur(8px)' }}
                            transition={{ type: 'spring', stiffness: 150, damping: 18, duration: 0.6 }}>
                            <NumberDisplay number={ticket.number} label={ticket.displayNumber} size={activeCounters.length === 1 ? 'hero' : 'lg'} />
                          </motion.div>
                        ) : (
                          <motion.span key="idle" className="dsp-counter-idle" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>—</motion.span>
                        )}
                      </AnimatePresence>
                    </div>
                    {cat && <div className="dsp-counter-cat" style={{ color: cat.color }}>{cat.name}</div>}
                  </motion.div>
                )
              })}
            </div>
          )}

          {/* Layout: Minimal — single focused number */}
          {layout === 'minimal' && (() => {
            const serving = activeCounters.filter(c => c.currentTicket)
            const latest = serving.length > 0 ? serving[serving.length - 1] : null
            const ticket = latest ? state.tickets.find(t => t.number === latest.currentTicket) : null
            return (
              <div className="dsp-minimal">
                <div className="dsp-minimal-label">{t('nowServing', lang)}</div>
                <AnimatePresence mode="wait">
                  <motion.div key={ticket?.number || 0}
                    initial={{ scale: 0.5, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 1.5, opacity: 0 }}
                    transition={{ type: 'spring', stiffness: 120, damping: 16 }}>
                    <NumberDisplay number={ticket?.number || 0} size="hero" />
                  </motion.div>
                </AnimatePresence>
                {latest && <div className="dsp-minimal-counter">{latest.name}</div>}
              </div>
            )
          })()}

          {/* Layout: Ticker — horizontal scroll of all serving */}
          {layout === 'ticker' && (
            <div className="dsp-ticker-layout">
              <div className="dsp-ticker-label">{t('nowServing', lang)}</div>
              <div className="dsp-ticker-row">
                {activeCounters.map(counter => {
                  const ticket = counter.currentTicket ? state.tickets.find(t => t.number === counter.currentTicket) : null
                  const cat = ticket ? state.categories.find(c => c.id === ticket.categoryId) : null
                  return (
                    <motion.div key={counter.id} className="dsp-ticker-card" layout>
                      <span className="dsp-ticker-cname">{counter.name}</span>
                      <span className="dsp-ticker-num">{ticket ? (ticket.displayNumber || padNumber(ticket.number)) : '—'}</span>
                      {cat && <span className="dsp-ticker-cat" style={{ color: cat.color }}>{cat.name}</span>}
                    </motion.div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Layout: List — full queue list */}
          {layout === 'list' && (
            <div className="dsp-list-layout">
              <div className="dsp-list-serving">
                <div className="dsp-list-heading">{t('nowServing', lang)}</div>
                {activeCounters.filter(c => c.currentTicket).map(counter => {
                  const ticket = state.tickets.find(t => t.number === counter.currentTicket)
                  const cat = ticket ? state.categories.find(c => c.id === ticket.categoryId) : null
                  return (
                    <div key={counter.id} className="dsp-list-row dsp-list-row--serving">
                      <span className="dsp-list-num">{(ticket.displayNumber || padNumber(ticket.number))}</span>
                      <span className="dsp-list-counter">{counter.name}</span>
                      {cat && <span className="dsp-list-cat" style={{ color: cat.color }}>{cat.name}</span>}
                    </div>
                  )
                })}
              </div>
              <div className="dsp-list-waiting">
                <div className="dsp-list-heading">{t('upcoming', lang)} ({waitingTickets.length})</div>
                <div className="dsp-list-scroll">
                  {waitingTickets.map(tk => {
                    const cat = state.categories.find(c => c.id === tk.categoryId)
                    return (
                      <div key={tk.number} className="dsp-list-row">
                        <span className="dsp-list-num">{(tk.displayNumber || padNumber(tk.number))}</span>
                        {cat && <span className="dsp-list-cat" style={{ color: cat.color }}>{cat.name}</span>}
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>
          )}

          {/* Layout: Spotlight — large hero + sidebar queue */}
          {layout === 'spotlight' && (() => {
            const serving = activeCounters.filter(c => c.currentTicket)
            const main = serving.length > 0 ? serving[serving.length - 1] : null
            const mainTicket = main ? state.tickets.find(t => t.number === main.currentTicket) : null
            const mainCat = mainTicket ? state.categories.find(c => c.id === mainTicket.categoryId) : null
            return (
              <div className="dsp-spot">
                <div className="dsp-spot-main">
                  <div className="dsp-spot-label">{t('nowServing', lang)}</div>
                  <AnimatePresence mode="wait">
                    <motion.div key={mainTicket?.number || 0}
                      initial={{ y: 60, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: -60, opacity: 0 }}
                      transition={{ type: 'spring', stiffness: 120, damping: 18 }}>
                      <NumberDisplay number={mainTicket?.number || 0} size="hero" />
                    </motion.div>
                  </AnimatePresence>
                  <div className="dsp-spot-info">
                    {main && <span className="dsp-spot-counter">{main.name}</span>}
                    {mainCat && <span className="dsp-spot-cat" style={{ color: mainCat.color }}>{mainCat.name}</span>}
                  </div>
                </div>
                <div className="dsp-spot-side">
                  {serving.length > 1 && (
                    <div className="dsp-spot-others">
                      <div className="dsp-spot-side-label">Also Serving</div>
                      {serving.slice(0, -1).map(c => {
                        const tk = state.tickets.find(t => t.number === c.currentTicket)
                        return tk && (
                          <div key={c.id} className="dsp-spot-other">
                            <span className="dsp-spot-other-num">{(tk.displayNumber || padNumber(tk.number))}</span>
                            <span className="dsp-spot-other-name">{c.name}</span>
                          </div>
                        )
                      })}
                    </div>
                  )}
                  <div className="dsp-spot-queue">
                    <div className="dsp-spot-side-label">{t('upcoming', lang)}</div>
                    {waitingTickets.slice(0, 8).map(tk => {
                      const cat = state.categories.find(c => c.id === tk.categoryId)
                      return (
                        <div key={tk.number} className="dsp-spot-q-row">
                          <span className="dsp-spot-q-bar" style={{ background: cat?.color }} />
                          <span className="dsp-spot-q-num">{(tk.displayNumber || padNumber(tk.number))}</span>
                        </div>
                      )
                    })}
                  </div>
                </div>
              </div>
            )
          })()}

          {/* Layout: Dual — split screen, serving left, upcoming right */}
          {layout === 'dual' && (
            <div className="dsp-dual">
              <div className="dsp-dual-left">
                <div className="dsp-dual-heading">{t('nowServing', lang)}</div>
                <div className="dsp-dual-cards">
                  {activeCounters.map(counter => {
                    const ticket = counter.currentTicket ? state.tickets.find(t => t.number === counter.currentTicket) : null
                    const cat = ticket ? state.categories.find(c => c.id === ticket.categoryId) : null
                    return (
                      <motion.div key={counter.id} className={`dsp-dual-card ${ticket ? 'dsp-dual-card--active' : ''}`} layout>
                        <span className="dsp-dual-cname">{counter.name}</span>
                        <AnimatePresence mode="wait">
                          <motion.span key={ticket?.number || 'idle'} className="dsp-dual-num"
                            initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }}>
                            {ticket ? (ticket.displayNumber || padNumber(ticket.number)) : '—'}
                          </motion.span>
                        </AnimatePresence>
                        {cat && <span className="dsp-dual-cat" style={{ color: cat.color }}>{cat.name}</span>}
                      </motion.div>
                    )
                  })}
                </div>
              </div>
              <div className="dsp-dual-right">
                <div className="dsp-dual-heading">{t('upcoming', lang)}</div>
                <div className="dsp-dual-queue">
                  {waitingTickets.map((tk, idx) => {
                    const cat = state.categories.find(c => c.id === tk.categoryId)
                    return (
                      <motion.div key={tk.number} className="dsp-dual-q-row"
                        initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: idx * 0.03 }}>
                        <span className="dsp-dual-q-pos">{idx + 1}</span>
                        <span className="dsp-dual-q-num">{(tk.displayNumber || padNumber(tk.number))}</span>
                        {cat && <span className="dsp-dual-q-cat" style={{ color: cat.color }}>{cat.name}</span>}
                      </motion.div>
                    )
                  })}
                  {waitingTickets.length === 0 && <div className="dsp-dual-empty">Queue is empty</div>}
                </div>
              </div>
            </div>
          )}

          {/* Layout: Board — airport/train station departure board style */}
          {layout === 'board' && (
            <div className="dsp-board">
              <div className="dsp-board-header">
                <span className="dsp-board-col">NUMBER</span>
                <span className="dsp-board-col">SERVICE</span>
                <span className="dsp-board-col">COUNTER</span>
                <span className="dsp-board-col">STATUS</span>
              </div>
              <div className="dsp-board-body">
                {activeCounters.filter(c => c.currentTicket).map(counter => {
                  const ticket = state.tickets.find(t => t.number === counter.currentTicket)
                  const cat = ticket ? state.categories.find(c => c.id === ticket.categoryId) : null
                  return (
                    <motion.div key={counter.id} className="dsp-board-row dsp-board-row--serving"
                      initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} layout>
                      <span className="dsp-board-cell dsp-board-num">
                        {(ticket.displayNumber || padNumber(ticket.number))}
                        {ticket.notes && (
                          <span style={{ display: 'block', fontSize: '0.45em', fontWeight: 500, color: 'var(--gray-1)', marginTop: 4, fontFamily: 'var(--font)' }}>
                            {ticket.notes}
                          </span>
                        )}
                      </span>
                      <span className="dsp-board-cell" style={{ color: cat?.color }}>{cat?.name || '—'}</span>
                      <span className="dsp-board-cell">{counter.name}</span>
                      <span className="dsp-board-cell dsp-board-status--now">NOW</span>
                    </motion.div>
                  )
                })}
                {waitingTickets.slice(0, 12).map((tk, idx) => {
                  const cat = state.categories.find(c => c.id === tk.categoryId)
                  return (
                    <motion.div key={tk.number} className="dsp-board-row"
                      initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: idx * 0.04 }}>
                      <span className="dsp-board-cell dsp-board-num">
                        {(tk.displayNumber || padNumber(tk.number))}
                        {tk.notes && (
                          <span style={{ display: 'block', fontSize: '0.45em', fontWeight: 500, color: 'var(--gray-2)', marginTop: 4, fontFamily: 'var(--font)' }}>
                            {tk.notes}
                          </span>
                        )}
                      </span>
                      <span className="dsp-board-cell" style={{ color: cat?.color }}>{cat?.name || '—'}</span>
                      <span className="dsp-board-cell">—</span>
                      <span className="dsp-board-cell dsp-board-status--wait">WAIT</span>
                    </motion.div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Layout: Cards — floating cards with depth */}
          {layout === 'cards' && (
            <div className="dsp-cards-layout">
              {activeCounters.map((counter, idx) => {
                const ticket = counter.currentTicket ? state.tickets.find(t => t.number === counter.currentTicket) : null
                const cat = ticket ? state.categories.find(c => c.id === ticket.categoryId) : null
                return (
                  <motion.div key={counter.id}
                    className={`dsp-fcard ${ticket ? 'dsp-fcard--active' : ''}`}
                    initial={{ opacity: 0, y: 40, rotateY: -10 }}
                    animate={{ opacity: 1, y: 0, rotateY: 0 }}
                    transition={{ delay: idx * 0.1, type: 'spring', stiffness: 100 }}
                    style={{ zIndex: activeCounters.length - idx }}>
                    <div className="dsp-fcard-top">
                      <span className="dsp-fcard-name">{counter.name}</span>
                      {counter.operatorName && <span className="dsp-fcard-op">{counter.operatorName}</span>}
                    </div>
                    <div className="dsp-fcard-center">
                      <AnimatePresence mode="wait">
                        <motion.span key={ticket?.number || 'idle'} className="dsp-fcard-num"
                          initial={{ scale: 0.5, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 1.5, opacity: 0 }}>
                          {ticket ? (ticket.displayNumber || padNumber(ticket.number)) : '—'}
                        </motion.span>
                      </AnimatePresence>
                    </div>
                    {cat && (
                      <div className="dsp-fcard-bottom">
                        <span className="dsp-fcard-cat-bar" style={{ background: cat.color }} />
                        <span className="dsp-fcard-cat">{cat.name}</span>
                      </div>
                    )}
                  </motion.div>
                )
              })}
            </div>
          )}

          {/* Layout: Stadium — matrix grid scoreboard */}
          {layout === 'stadium' && (
            <div className="dsp-stadium">
              <div className="dsp-stadium-grid">
                {Array.from({ length: Math.max(state.nextTicketNumber - 1, 12) }, (_, i) => i + 1).slice(-24).map(num => {
                  const tk = state.tickets.find(t => t.number === num)
                  const isServing = tk?.status === 'serving'
                  const isServed = tk?.status === 'served'
                  return (
                    <div key={num} className={`dsp-stad-cell ${isServing ? 'dsp-stad-cell--now' : ''} ${isServed ? 'dsp-stad-cell--done' : ''}`}>
                      {padNumber(num)}
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Layout: Terminal — retro green DOS style */}
          {layout === 'terminal' && (
            <div className="dsp-term">
              <div className="dsp-term-line">{'>'} QUEUE MANAGEMENT SYSTEM v1.0</div>
              <div className="dsp-term-line">{'>'} STATUS: ACTIVE | COUNTERS: {activeCounters.length}</div>
              <div className="dsp-term-line dsp-term-sep">{'─'.repeat(50)}</div>
              <div className="dsp-term-line dsp-term-head">{'>'} NOW SERVING:</div>
              {activeCounters.filter(c => c.currentTicket).map(c => {
                const tk = state.tickets.find(t => t.number === c.currentTicket)
                return tk && (
                  <div key={c.id} className="dsp-term-line dsp-term-serving">
                    {'  '}[{(tk.displayNumber || padNumber(tk.number))}] → {c.name} {c.operatorName ? `(${c.operatorName})` : ''}<span className="dsp-term-cursor">█</span>
                  </div>
                )
              })}
              <div className="dsp-term-line dsp-term-sep">{'─'.repeat(50)}</div>
              <div className="dsp-term-line dsp-term-head">{'>'} QUEUE ({waitingTickets.length} waiting):</div>
              {waitingTickets.slice(0, 10).map(tk => (
                <div key={tk.number} className="dsp-term-line">{'  '}{(tk.displayNumber || padNumber(tk.number))}</div>
              ))}
              <div className="dsp-term-line dsp-term-blink">{'>'} _</div>
            </div>
          )}

          {/* Layout: News — TV news channel */}
          {layout === 'news' && (() => {
            const serving = activeCounters.filter(c => c.currentTicket)
            const main = serving[serving.length - 1]
            const mainTk = main ? state.tickets.find(t => t.number === main.currentTicket) : null
            return (
              <div className="dsp-news">
                <div className="dsp-news-main">
                  <div className="dsp-news-badge">LIVE</div>
                  <div className="dsp-news-now">{t('nowServing', lang)}</div>
                  <div className="dsp-news-num">{mainTk ? (mainTk.displayNumber || padNumber(mainTk.number)) : '—'}</div>
                  {main && <div className="dsp-news-counter">{main.name}</div>}
                </div>
                <div className="dsp-news-sidebar">
                  <div className="dsp-news-side-title">{t('upcoming', lang)}</div>
                  {waitingTickets.slice(0, 6).map(tk => {
                    const cat = state.categories.find(c => c.id === tk.categoryId)
                    return (
                      <div key={tk.number} className="dsp-news-side-row">
                        <span className="dsp-news-side-num">{(tk.displayNumber || padNumber(tk.number))}</span>
                        {cat && <span style={{ color: cat.color, fontSize: 11 }}>{cat.name}</span>}
                      </div>
                    )
                  })}
                </div>
                <div className="dsp-news-stats">
                  <span>Waiting: {totalWaiting}</span>
                  <span>Served: {servedTickets.length}</span>
                  <span>Counters: {activeCounters.length}</span>
                </div>
              </div>
            )
          })()}

          {/* Layout: Table — spreadsheet style */}
          {layout === 'table' && (
            <div className="dsp-tbl">
              <div className="dsp-tbl-head">
                <span>#</span><span>Category</span><span>Counter</span><span>Wait</span><span>Status</span>
              </div>
              <div className="dsp-tbl-body">
                {activeCounters.filter(c => c.currentTicket).map(c => {
                  const tk = state.tickets.find(t => t.number === c.currentTicket)
                  const cat = tk ? state.categories.find(ct => ct.id === tk.categoryId) : null
                  return tk && (
                    <div key={c.id} className="dsp-tbl-row dsp-tbl-row--now">
                      <span className="dsp-tbl-num">{(tk.displayNumber || padNumber(tk.number))}</span>
                      <span style={{ color: cat?.color }}>{cat?.name}</span>
                      <span>{c.name}</span>
                      <span>{Math.round((Date.now() - tk.createdAt) / 60000)}m</span>
                      <span className="dsp-tbl-status-now">SERVING</span>
                    </div>
                  )
                })}
                {waitingTickets.map(tk => {
                  const cat = state.categories.find(c => c.id === tk.categoryId)
                  return (
                    <div key={tk.number} className="dsp-tbl-row">
                      <span className="dsp-tbl-num">{(tk.displayNumber || padNumber(tk.number))}</span>
                      <span style={{ color: cat?.color }}>{cat?.name}</span>
                      <span>—</span>
                      <span>{Math.round((Date.now() - tk.createdAt) / 60000)}m</span>
                      <span className="dsp-tbl-status-wait">WAITING</span>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Layout: Orbit — rotating ring */}
          {layout === 'orbit' && (() => {
            const serving = activeCounters.filter(c => c.currentTicket)
            const mainTk = serving[0] ? state.tickets.find(t => t.number === serving[0].currentTicket) : null
            return (
              <div className="dsp-orbit">
                <div className="dsp-orbit-center">
                  <div className="dsp-orbit-label">{t('nowServing', lang)}</div>
                  <div className="dsp-orbit-num">{mainTk ? (mainTk.displayNumber || padNumber(mainTk.number)) : '—'}</div>
                </div>
                <div className="dsp-orbit-ring">
                  {waitingTickets.slice(0, 8).map((tk, i) => {
                    const angle = (i / Math.min(waitingTickets.length, 8)) * 360
                    const cat = state.categories.find(c => c.id === tk.categoryId)
                    return (
                      <div key={tk.number} className="dsp-orbit-item"
                        style={{ '--angle': `${angle}deg`, '--color': cat?.color || 'var(--gray-2)' }}>
                        {(tk.displayNumber || padNumber(tk.number))}
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })()}

          {/* Layout: Bubble — floating circles */}
          {layout === 'bubble' && (
            <div className="dsp-bubble">
              {activeCounters.filter(c => c.currentTicket).map(c => {
                const tk = state.tickets.find(t => t.number === c.currentTicket)
                const cat = tk ? state.categories.find(ct => ct.id === tk.categoryId) : null
                return tk && (
                  <motion.div key={tk.number} className="dsp-bub dsp-bub--serving"
                    animate={{ y: [0, -8, 0] }} transition={{ repeat: Infinity, duration: 3 }}
                    style={{ borderColor: cat?.color }}>
                    <span className="dsp-bub-num">{(tk.displayNumber || padNumber(tk.number))}</span>
                    <span className="dsp-bub-label">{c.name}</span>
                  </motion.div>
                )
              })}
              {waitingTickets.slice(0, 10).map((tk, i) => {
                const cat = state.categories.find(c => c.id === tk.categoryId)
                return (
                  <motion.div key={tk.number} className="dsp-bub"
                    animate={{ y: [0, -4, 0] }} transition={{ repeat: Infinity, duration: 4, delay: i * 0.3 }}>
                    <span className="dsp-bub-num dsp-bub-num--sm">{(tk.displayNumber || padNumber(tk.number))}</span>
                  </motion.div>
                )
              })}
            </div>
          )}

          {/* Layout: Tower — vertical stack with perspective */}
          {layout === 'tower' && (() => {
            const serving = activeCounters.filter(c => c.currentTicket)
            const mainTk = serving[0] ? state.tickets.find(t => t.number === serving[0].currentTicket) : null
            return (
              <div className="dsp-tower">
                <div className="dsp-tower-top">
                  <div className="dsp-tower-label">{t('nowServing', lang)}</div>
                  <div className="dsp-tower-main">{mainTk ? (mainTk.displayNumber || padNumber(mainTk.number)) : '—'}</div>
                </div>
                <div className="dsp-tower-stack">
                  {waitingTickets.slice(0, 6).map((tk, i) => {
                    const cat = state.categories.find(c => c.id === tk.categoryId)
                    const scale = 1 - (i * 0.08)
                    const opacity = 1 - (i * 0.12)
                    return (
                      <div key={tk.number} className="dsp-tower-item"
                        style={{ transform: `scale(${scale})`, opacity, borderLeftColor: cat?.color }}>
                        {(tk.displayNumber || padNumber(tk.number))}
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })()}

          {/* Layout: Mosaic — masonry tiles */}
          {layout === 'mosaic' && (
            <div className="dsp-mosaic">
              {activeCounters.filter(c => c.currentTicket).map(c => {
                const tk = state.tickets.find(t => t.number === c.currentTicket)
                const cat = tk ? state.categories.find(ct => ct.id === tk.categoryId) : null
                return tk && (
                  <motion.div key={tk.number} className="dsp-mos dsp-mos--now"
                    style={{ background: cat?.color ? `${cat.color}18` : 'var(--blue-dim)', borderColor: cat?.color }}
                    layout initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}>
                    <span className="dsp-mos-num">{(tk.displayNumber || padNumber(tk.number))}</span>
                    <span className="dsp-mos-counter">{c.name}</span>
                    {cat && <span className="dsp-mos-cat" style={{ color: cat.color }}>{cat.name}</span>}
                  </motion.div>
                )
              })}
              {waitingTickets.slice(0, 12).map(tk => {
                const cat = state.categories.find(c => c.id === tk.categoryId)
                return (
                  <div key={tk.number} className="dsp-mos" style={{ borderLeftColor: cat?.color }}>
                    <span className="dsp-mos-num dsp-mos-num--sm">{(tk.displayNumber || padNumber(tk.number))}</span>
                  </div>
                )
              })}
            </div>
          )}

          {/* Layout: Split — top hero, bottom strip */}
          {layout === 'split' && (() => {
            const serving = activeCounters.filter(c => c.currentTicket)
            const main = serving[serving.length - 1]
            const mainTk = main ? state.tickets.find(t => t.number === main.currentTicket) : null
            return (
              <div className="dsp-split">
                <div className="dsp-split-top">
                  <NumberDisplay number={mainTk?.number || 0} size="hero" />
                  {main && <div className="dsp-split-counter">{main.name}</div>}
                </div>
                <div className="dsp-split-strip">
                  <div className="dsp-split-strip-label">{t('upcoming', lang)}</div>
                  <div className="dsp-split-strip-row">
                    {waitingTickets.slice(0, 10).map(tk => {
                      const cat = state.categories.find(c => c.id === tk.categoryId)
                      return (
                        <span key={tk.number} className="dsp-split-chip" style={{ borderBottomColor: cat?.color }}>
                          {(tk.displayNumber || padNumber(tk.number))}
                        </span>
                      )
                    })}
                  </div>
                </div>
              </div>
            )
          })()}

          {/* Layout: Sidebar — giant number with queue sidebar */}
          {layout === 'sidebar' && (() => {
            const serving = activeCounters.filter(c => c.currentTicket)
            const main = serving[serving.length - 1]
            const mainTk = main ? state.tickets.find(t => t.number === main.currentTicket) : null
            return (
              <div className="dsp-sbar">
                <div className="dsp-sbar-list">
                  <div className="dsp-sbar-head">{t('upcoming', lang)}</div>
                  {waitingTickets.slice(0, 15).map((tk, i) => {
                    const cat = state.categories.find(c => c.id === tk.categoryId)
                    return (
                      <div key={tk.number} className="dsp-sbar-row">
                        <span className="dsp-sbar-pos">{i + 1}</span>
                        <span className="dsp-sbar-num">{(tk.displayNumber || padNumber(tk.number))}</span>
                        <span className="dsp-sbar-cat" style={{ color: cat?.color }}>{cat?.name}</span>
                      </div>
                    )
                  })}
                </div>
                <div className="dsp-sbar-main">
                  <NumberDisplay number={mainTk?.number || 0} size="hero" />
                  {main && <div className="dsp-sbar-counter">{main.name}</div>}
                </div>
              </div>
            )
          })()}

          {/* Layout: Zen — nothing but the number */}
          {layout === 'zen' && (() => {
            const serving = activeCounters.filter(c => c.currentTicket)
            const mainTk = serving[0] ? state.tickets.find(t => t.number === serving[0].currentTicket) : null
            return (
              <div className="dsp-zen">
                <AnimatePresence mode="wait">
                  <motion.div key={mainTk?.number || 0} className="dsp-zen-num"
                    initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                    transition={{ duration: 0.8 }}>
                    {mainTk ? (mainTk.displayNumber || padNumber(mainTk.number)) : ''}
                  </motion.div>
                </AnimatePresence>
              </div>
            )
          })()}

          {/* Layout: Banner — horizontal continuous scroll */}
          {layout === 'banner' && (
            <div className="dsp-bnr">
              <div className="dsp-bnr-label">{t('nowServing', lang)}</div>
              <div className="dsp-bnr-scroll">
                <div className="dsp-bnr-track">
                  {activeCounters.filter(c => c.currentTicket).map(c => {
                    const tk = state.tickets.find(t => t.number === c.currentTicket)
                    return tk && (
                      <span key={c.id} className="dsp-bnr-item dsp-bnr-item--now">
                        {c.name}: <strong>{(tk.displayNumber || padNumber(tk.number))}</strong>
                      </span>
                    )
                  })}
                  {waitingTickets.slice(0, 8).map(tk => (
                    <span key={tk.number} className="dsp-bnr-item">{(tk.displayNumber || padNumber(tk.number))}</span>
                  ))}
                  {activeCounters.filter(c => c.currentTicket).map(c => {
                    const tk = state.tickets.find(t => t.number === c.currentTicket)
                    return tk && (
                      <span key={`d-${c.id}`} className="dsp-bnr-item dsp-bnr-item--now">
                        {c.name}: <strong>{(tk.displayNumber || padNumber(tk.number))}</strong>
                      </span>
                    )
                  })}
                </div>
              </div>
            </div>
          )}

          {/* Layout: Hospital — room style */}
          {layout === 'hospital' && (
            <div className="dsp-hosp">
              {activeCounters.map(counter => {
                const ticket = counter.currentTicket ? state.tickets.find(t => t.number === counter.currentTicket) : null
                return (
                  <div key={counter.id} className={`dsp-hosp-room ${ticket ? 'dsp-hosp-room--active' : ''}`}>
                    <div className="dsp-hosp-room-name">{counter.name.replace('Counter', 'Room')}</div>
                    <div className="dsp-hosp-room-doc">{counter.operatorName || '—'}</div>
                    <div className="dsp-hosp-room-num">{ticket ? (ticket.displayNumber || padNumber(ticket.number)) : '—'}</div>
                    <div className="dsp-hosp-room-status">{ticket ? 'In Session' : 'Available'}</div>
                  </div>
                )
              })}
            </div>
          )}

          {/* Layout: Bank — LED dot-matrix style */}
          {layout === 'bank' && (
            <div className="dsp-bank">
              {activeCounters.map(counter => {
                const ticket = counter.currentTicket ? state.tickets.find(t => t.number === counter.currentTicket) : null
                return (
                  <div key={counter.id} className="dsp-bank-panel">
                    <div className="dsp-bank-name">{counter.name}</div>
                    <div className="dsp-bank-num">{ticket ? (ticket.displayNumber || padNumber(ticket.number)) : '---'}</div>
                  </div>
                )
              })}
            </div>
          )}

          {/* Layout: Restaurant — order ready */}
          {layout === 'restaurant' && (
            <div className="dsp-resto">
              <div className="dsp-resto-ready">
                <div className="dsp-resto-title">Order Ready</div>
                <div className="dsp-resto-nums">
                  {activeCounters.filter(c => c.currentTicket).map(c => {
                    const tk = state.tickets.find(t => t.number === c.currentTicket)
                    return tk && (
                      <motion.div key={tk.number} className="dsp-resto-num"
                        initial={{ scale: 0.5, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
                        transition={{ type: 'spring', stiffness: 200 }}>
                        {(tk.displayNumber || padNumber(tk.number))}
                      </motion.div>
                    )
                  })}
                </div>
              </div>
              <div className="dsp-resto-prep">
                <div className="dsp-resto-prep-title">Preparing</div>
                <div className="dsp-resto-prep-nums">
                  {waitingTickets.slice(0, 8).map(tk => (
                    <span key={tk.number} className="dsp-resto-prep-num">{(tk.displayNumber || padNumber(tk.number))}</span>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Floor map */}
          {state.settings.floorMapEnabled && (
            <div className="dsp-floor">
              <div className="dsp-floor-label">{t('floorMap', lang)}</div>
              <div className="dsp-floor-grid">
                {state.counters.filter(c => c.status === 'open').map(c => (
                  <div key={c.id} className={`dsp-floor-counter ${c.currentTicket ? 'dsp-floor-counter--active' : ''}`}>
                    <span className="dsp-floor-name">{c.name}</span>
                    {c.currentTicket && (
                      <span className="dsp-floor-num">{padNumber(c.currentTicket)}</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Bottom */}
          <div className="dsp-bottom">
            <div className="dsp-meta">
              {/* Clock + Weather inline */}
              <div className="dsp-info-block">
                {weather && (
                  <>
                    <span className="dsp-weather-icon">{weather.icon}</span>
                    <span className="dsp-weather-temp">{weather.temp}{weather.unit}</span>
                    <div className="dsp-stat-sep" />
                  </>
                )}
                <div className="dsp-clock-inline">
                  <span className="dsp-clock-time">{clockStr}</span>
                  <span className="dsp-clock-date">{dateStr}</span>
                </div>
              </div>

              <div style={{ flex: 1 }} />

              <div className="dsp-stat">
                <span className="dsp-stat-val">{totalWaiting}</span>
                <span className="dsp-stat-label">{t('waiting', lang)}</span>
              </div>
              <div className="dsp-stat-sep" />
              <div className="dsp-stat">
                <span className="dsp-stat-val">{state.nextTicketNumber - 1}</span>
                <span className="dsp-stat-label">{t('issued', lang)}</span>
              </div>
            </div>

            {/* Upcoming with progress bars */}
            {waitingTickets.length > 0 && (
              <div className="dsp-section">
                <div className="dsp-section-label">{t('upcoming', lang)}</div>
                <div className="dsp-section-row">
                  {waitingTickets.slice(0, 8).map((tk, idx) => {
                    const c = state.categories.find(cat => cat.id === tk.categoryId)
                    const progress = Math.max(5, Math.min(95, 100 - (idx / Math.max(waitingTickets.length, 1)) * 100))
                    return (
                      <div key={tk.number} className="dsp-upcoming-chip" style={{ borderLeftColor: c?.color }}>
                        <span className="dsp-upcoming-num">{(tk.displayNumber || padNumber(tk.number))}</span>
                        <div className="dsp-progress-bar">
                          <div className="dsp-progress-fill" style={{ width: `${progress}%`, background: c?.color }} />
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {servedTickets.length > 0 && (
              <div className="dsp-section">
                <div className="dsp-section-label" style={{ color: 'var(--gray-3)' }}>{t('served', lang)}</div>
                <div className="dsp-section-row">
                  {servedTickets.slice(0, 10).map(tk => (
                    <span key={tk.number} className="dsp-served-chip">{(tk.displayNumber || padNumber(tk.number))}</span>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      <button className={`dsp-fs no-print ${isFs ? 'dsp-fs--active' : ''}`} onClick={toggleFs} aria-label="Fullscreen">
        {isFs ? (
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M5 2v3H2M11 2v3h3M5 14v-3H2M11 14v-3h3" /></svg>
        ) : (
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M2 6V2h4M14 6V2h-4M2 10v4h4M14 10v4h-4" /></svg>
        )}
      </button>
    </div>
  )
}
