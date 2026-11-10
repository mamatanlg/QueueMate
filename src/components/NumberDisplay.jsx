import { useEffect, useState, useRef } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { padNumber } from '../utils/formatters'
import './NumberDisplay.css'

export default function NumberDisplay({ number, label, size = 'lg' }) {
  const [flash, setFlash] = useState(false)
  const prevRef = useRef(number)

  useEffect(() => {
    if (number !== prevRef.current && number > 0) {
      setFlash(true)
      const t = setTimeout(() => setFlash(false), 1000)
      prevRef.current = number
      return () => clearTimeout(t)
    }
    prevRef.current = number
  }, [number])

  const display = label || padNumber(number)

  return (
    <div className={`num-wrap num-wrap--${size} ${flash ? 'num-wrap--flash' : ''}`}>
      <div className="num-ring" />
      <div className="num-ring" />
      <div className="num-ring" />
      <AnimatePresence mode="wait">
        <motion.div
          key={display}
          className="num-val"
          initial={{ opacity: 0, scale: 0.5, filter: 'blur(12px)' }}
          animate={{ opacity: 1, scale: 1, filter: 'blur(0px)' }}
          exit={{ opacity: 0, scale: 1.3, filter: 'blur(12px)' }}
          transition={{ type: 'spring', stiffness: 160, damping: 18 }}
        >
          {display}
        </motion.div>
      </AnimatePresence>
    </div>
  )
}
