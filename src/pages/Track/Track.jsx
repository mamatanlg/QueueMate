import { useState, useEffect, useRef } from 'react'
import { useParams } from 'react-router-dom'
import { motion } from 'framer-motion'
import { useSocket } from '../../context/SocketContext'
import { padNumber } from '../../utils/formatters'
import { playChime } from '../../utils/sounds'
import './Track.css'

export default function Track() {
  const { ticketNumber } = useParams()
  const { emit, state } = useSocket()
  const [input, setInput] = useState(ticketNumber || '')
  const [result, setResult] = useState(null)
  const [loading, setLoading] = useState(false)
  const prevPositionRef = useRef(null)

  const lookup = async (num) => {
    if (!num) return
    setLoading(true)
    const data = await emit('track:lookup', { ticketNumber: parseInt(num) })
    setResult(data)
    setLoading(false)
  }

  // Auto-lookup if URL param
  useEffect(() => {
    if (ticketNumber) lookup(ticketNumber)
  }, [ticketNumber])

  // Auto-refresh every 10s
  useEffect(() => {
    if (!result?.ticket) return
    const i = setInterval(() => lookup(result.ticket.number), 10000)
    return () => clearInterval(i)
  }, [result?.ticket?.number])

  // Sound when position changes (getting closer or it's your turn)
  useEffect(() => {
    if (!result?.ticket) return
    const pos = result.position
    if (prevPositionRef.current !== null && pos < prevPositionRef.current) {
      if (result.ticket.status === 'serving' || pos <= 2) {
        playChime('bell', 1)
      } else {
        playChime('ding', 0.5)
      }
    }
    prevPositionRef.current = pos
  }, [result?.position, result?.ticket?.status])

  const handleSubmit = (e) => {
    e.preventDefault()
    lookup(input)
  }

  return (
    <div className="trk">
      {/* Standalone view — patients reach this via QR scan from their printed
          ticket. No back-link or other nav so they can't drift onto operator
          pages and accidentally mess things up. */}
      <div className="trk-bg" />

      <div className="trk-content">
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
          <h1 className="trk-title">Track Your Number</h1>
          <p className="trk-sub ar">تتبع رقمك</p>

          <form className="trk-form" onSubmit={handleSubmit}>
            <input
              className="trk-input"
              type="number"
              placeholder="Enter your number..."
              value={input}
              onChange={e => setInput(e.target.value)}
              min="1"
            />
            <button className="trk-submit" type="submit" disabled={!input || loading}>
              {loading ? '...' : 'Track'}
            </button>
          </form>
        </motion.div>

        {result && (
          <motion.div
            className="trk-result"
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
          >
            {!result.ticket ? (
              <div className="trk-notfound">
                <p>Ticket not found</p>
                <p className="ar">التذكرة غير موجودة</p>
              </div>
            ) : result.ticket.status === 'served' ? (
              <div className="trk-status trk-status--served">
                <div className="trk-status-icon">✓</div>
                <h2>#{padNumber(result.ticket.number)} — Served</h2>
                <p className="ar">تمت الخدمة</p>
              </div>
            ) : result.ticket.status === 'serving' ? (
              <div className="trk-status trk-status--serving">
                <div className="trk-status-icon trk-status-icon--pulse">!</div>
                <h2>#{padNumber(result.ticket.number)} — It's Your Turn!</h2>
                <p className="ar">حان دورك!</p>
                <p className="trk-counter">Please go to your assigned counter</p>
              </div>
            ) : result.ticket.status === 'skipped' ? (
              <div className="trk-status trk-status--skipped">
                <div className="trk-status-icon">✕</div>
                <h2>#{padNumber(result.ticket.number)} — Skipped</h2>
                <p className="ar">تم التخطي</p>
              </div>
            ) : (
              <div className="trk-status trk-status--waiting">
                <div className="trk-pos-num">{result.position}</div>
                <div className="trk-pos-label">Position in Queue</div>
                <div className="trk-pos-label ar">الموقع في الطابور</div>

                <div className="trk-wait-grid">
                  <div className="trk-wait-item">
                    <span className="trk-wait-val">{result.ticket.displayNumber || `#${padNumber(result.ticket.number)}`}</span>
                    <span className="trk-wait-label">Your Number</span>
                  </div>
                  <div className="trk-wait-sep" />
                  <div className="trk-wait-item">
                    <span className="trk-wait-val">~{result.estimatedWait}m</span>
                    <span className="trk-wait-label">Est. Wait</span>
                  </div>
                </div>

                {/* Stage progress for multi-stage tickets */}
                {(() => {
                  const cat = state.categories.find(c => c.id === result.ticket.categoryId)
                  const stages = cat?.stages || []
                  if (stages.length <= 1) return null
                  const current = result.ticket.currentStage || 0
                  return (
                    <div className="trk-stages">
                      <div className="trk-stages-label">Your Journey</div>
                      <div className="trk-stages-list">
                        {stages.map((s, i) => (
                          <div key={s.id} className={`trk-stage ${i < current ? 'trk-stage--done' : ''} ${i === current ? 'trk-stage--current' : ''}`}>
                            <div className="trk-stage-dot">{i < current ? '✓' : i + 1}</div>
                            <span className="trk-stage-name">{s.name}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )
                })()}

                <p className="trk-auto">Auto-refreshes every 10 seconds</p>
              </div>
            )}
          </motion.div>
        )}
      </div>
    </div>
  )
}
