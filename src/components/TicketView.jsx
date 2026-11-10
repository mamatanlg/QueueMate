import { motion } from 'framer-motion'
import { QRCodeSVG } from 'qrcode.react'
import { padNumber, toArabicNumerals, formatTime, formatDate } from '../utils/formatters'
import './TicketView.css'

export default function TicketView({ ticket, categories, tickets, onPrint, onClose }) {
  const cat = categories.find(c => c.id === ticket.categoryId)
  const ahead = tickets.filter(
    t => t.status === 'waiting' && t.categoryId === ticket.categoryId && t.number < ticket.number
  ).length
  const waitMin = (ahead + 1) * 2
  const trackUrl = `${window.location.origin}/track/${ticket.number}`

  return (
    <motion.div
      className="tkt-overlay"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      <motion.div
        className="tkt"
        initial={{ y: 60, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 60, opacity: 0 }}
        transition={{ type: 'spring', stiffness: 260, damping: 28 }}
      >
        <div className="tkt-notch" />

        <div className="tkt-body">
          <div className="tkt-header">
            <span className="tkt-brand">QUEUE</span>
            <span className="tkt-date">{formatDate(Date.now())}</span>
          </div>

          {cat && (
            <div className="tkt-cat" style={{ color: cat.color, borderColor: cat.color }}>
              {cat.name}
            </div>
          )}

          <div className="tkt-number-section">
            <span className="tkt-your">YOUR NUMBER</span>
            <div className="tkt-num">{ticket.displayNumber || padNumber(ticket.number)}</div>
            <div className="tkt-num-ar ar">{toArabicNumerals(ticket.number)}</div>
          </div>

          <div className="tkt-divider">
            <div className="tkt-circle tkt-circle--l" />
            <div className="tkt-dash" />
            <div className="tkt-circle tkt-circle--r" />
          </div>

          <div className="tkt-details">
            <div className="tkt-row">
              <span>Time</span>
              <span>{formatTime(Date.now())}</span>
            </div>
            <div className="tkt-row">
              <span>Position</span>
              <span>#{ahead + 1}</span>
            </div>
            <div className="tkt-row">
              <span>Est. Wait</span>
              <span>~{waitMin} min</span>
            </div>
          </div>

          <div className="tkt-qr">
            <QRCodeSVG value={trackUrl} size={80} bgColor="#fafafa" fgColor="#111" level="M" />
            <span className="tkt-qr-hint">Scan to track your position</span>
          </div>

          <div className="tkt-footer">
            <p>Please wait for your number to be called</p>
            <p className="ar">يرجى الانتظار حتى يتم مناداة رقمك</p>
          </div>
        </div>

        <div className="tkt-actions no-print">
          <button className="tkt-btn tkt-btn--print" onClick={onPrint}>Print</button>
          <button className="tkt-btn tkt-btn--done" onClick={onClose}>Done</button>
        </div>
      </motion.div>
    </motion.div>
  )
}
