import { motion, AnimatePresence } from 'framer-motion'
import { padNumber, formatTime } from '../utils/formatters'
import './HistoryTicker.css'

export default function HistoryTicker({ history = [] }) {
  const recent = history.slice(0, 12)

  return (
    <div className="ticker">
      <div className="ticker-head">Recently Served</div>
      <div className="ticker-row">
        <AnimatePresence>
          {recent.map((item, i) => (
            <motion.div
              key={`${item.number}-${item.timestamp}`}
              className="ticker-chip"
              initial={{ opacity: 0, scale: 0.8, x: -20 }}
              animate={{ opacity: 1, scale: 1, x: 0 }}
              exit={{ opacity: 0, scale: 0.8 }}
              transition={{ delay: i * 0.03, duration: 0.25 }}
            >
              <span className="ticker-chip-num">{padNumber(item.number)}</span>
              <span className="ticker-chip-time">{formatTime(item.timestamp)}</span>
            </motion.div>
          ))}
        </AnimatePresence>
        {recent.length === 0 && <span className="ticker-empty">No numbers called yet</span>}
      </div>
    </div>
  )
}
