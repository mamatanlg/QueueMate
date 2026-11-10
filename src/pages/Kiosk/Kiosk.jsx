import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { useSocket } from '../../context/SocketContext'
import TicketView from '../../components/TicketView'
import { t } from '../../utils/i18n'
import './Kiosk.css'

export default function Kiosk() {
  const { state, emit } = useSocket()
  const [ticket, setTicket] = useState(null)
  const [catWaits, setCatWaits] = useState({})
  const lang = state.settings.uiLang || 'en'

  const waiting = state.tickets.filter(t => t.status === 'waiting').length

  // Load category wait times
  useEffect(() => {
    emit('admin:categoryWaits', {}).then(setCatWaits)
    const i = setInterval(() => emit('admin:categoryWaits', {}).then(setCatWaits), 15000)
    return () => clearInterval(i)
  }, [emit])

  useEffect(() => {
    if (!ticket) return
    // 60s gives the customer time to print, take the ticket, and leave the kiosk
    // before it auto-resets for the next user.
    const timer = setTimeout(() => setTicket(null), 60000)
    return () => clearTimeout(timer)
  }, [ticket])

  const handleTake = async (categoryId) => {
    const t = await emit('ticket:take', { categoryId })
    setTicket(t)
  }

  const allClosed = state.counters.every(c => c.status === 'closed')

  if (allClosed) {
    return (
      <div className="ksk">
        <div className="ksk-bg" />
        <Link to="/" className="ksk-back no-print">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M10 3L5 8l5 5"/></svg>
        </Link>
        {state.settings.logoUrl && <img src={state.settings.logoUrl} className="ksk-logo" alt="" />}
        <motion.div className="ksk-closed" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
          <div className="ksk-closed-x">
            <svg width="28" height="28" viewBox="0 0 28 28" fill="none" stroke="currentColor" strokeWidth="2"><path d="M8 8l12 12M20 8L8 20"/></svg>
          </div>
          <h2>{t('serviceClosed', lang)}</h2>
          {lang !== 'ar' && <p className="ar">{t('serviceClosed', 'ar')}</p>}
          <p className="ksk-closed-sub">{t('comeBackLater', lang)}</p>
        </motion.div>
      </div>
    )
  }

  return (
    <div className="ksk">
      <div className="ksk-bg" />

      <Link to="/" className="ksk-back no-print">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M10 3L5 8l5 5"/></svg>
      </Link>

      {state.settings.logoUrl && <img src={state.settings.logoUrl} className="ksk-logo" alt="" />}

      <div className="ksk-content">
        {!ticket && (
          <motion.div className="ksk-step" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}>
            <div className="ksk-head">
              <h1>{t('selectService', lang)}</h1>
              {lang !== 'ar' && <p className="ar">{t('selectService', 'ar')}</p>}
            </div>

            <div className="ksk-cats">
              {state.categories.map(cat => {
                const cw = catWaits[cat.id]
                const catName = lang === 'ar' ? cat.nameAr : lang === 'ur' ? cat.nameUr : lang === 'fr' ? cat.nameFr : cat.name
                return (
                  <motion.button
                    key={cat.id}
                    className="ksk-cat"
                    onClick={() => handleTake(cat.id)}
                    whileTap={{ scale: 0.97 }}
                  >
                    <div className="ksk-cat-bar" style={{ background: cat.color }} />
                    <div className="ksk-cat-body">
                      <span className="ksk-cat-name">{catName || cat.name}</span>
                      {lang !== 'ar' && cat.nameAr && <span className="ksk-cat-name-ar ar">{cat.nameAr}</span>}
                    </div>
                    {cw && (
                      <div className="ksk-cat-wait">
                        <span className="ksk-cat-wait-time">~{cw.estWaitMin}m</span>
                        <span className="ksk-cat-wait-count">{cw.waiting} {t('waiting', lang).toLowerCase()}</span>
                      </div>
                    )}
                  </motion.button>
                )
              })}
            </div>

            <div className="ksk-info">
              <div className="ksk-info-item">
                <span className="ksk-info-val">{waiting}</span>
                <span className="ksk-info-label">{t('inQueue', lang)}</span>
              </div>
            </div>
          </motion.div>
        )}
      </div>

      <AnimatePresence>
        {ticket && (
          <TicketView
            ticket={ticket}
            categories={state.categories}
            tickets={state.tickets}
            lang={lang}
            onPrint={() => window.print()}
            onClose={() => setTicket(null)}
          />
        )}
      </AnimatePresence>
    </div>
  )
}
