import { createContext, useContext, useEffect, useState, useRef } from 'react'
import { io } from 'socket.io-client'

const Ctx = createContext(null)

function LicenseGate({ emit, onActivated }) {
  const [key, setKey] = useState('')
  const [error, setError] = useState(false)
  const [loading, setLoading] = useState(false)

  const handleActivate = async () => {
    if (!key.trim()) return
    setLoading(true)
    setError(false)
    const valid = await emit('license:activate', { key: key.trim() })
    setLoading(false)
    if (valid) {
      onActivated()
    } else {
      setError(true)
    }
  }

  return (
    <div style={{
      height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'var(--bg)', fontFamily: 'var(--font)',
    }}>
      <div style={{
        background: 'var(--bg-raised)', border: '1px solid var(--border)',
        borderRadius: 20, padding: '40px 36px', maxWidth: 400, width: '90%', textAlign: 'center',
      }}>
        <div style={{
          width: 56, height: 56, borderRadius: 14, background: 'var(--blue)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          margin: '0 auto 20px', fontSize: 24, fontWeight: 800, color: '#fff',
          fontFamily: 'var(--font-mono)',
        }}>Q</div>
        <h1 style={{ fontSize: 22, fontWeight: 800, color: 'var(--white)', marginBottom: 6 }}>
          Queue System
        </h1>
        <p style={{ fontSize: 13, color: 'var(--gray-2)', marginBottom: 24, lineHeight: 1.5 }}>
          Enter your license key to activate
        </p>

        <input
          type="text"
          value={key}
          onChange={e => { setKey(e.target.value.toUpperCase()); setError(false) }}
          onKeyDown={e => e.key === 'Enter' && handleActivate()}
          placeholder="QS-XXXX-XXXX-XXXX-XXXX-XXXX"
          autoFocus
          style={{
            width: '100%', padding: '12px 14px', borderRadius: 10,
            background: 'var(--bg-surface)', border: `1px solid ${error ? 'var(--red)' : 'var(--border)'}`,
            color: 'var(--white)', fontSize: 15, fontFamily: 'var(--font-mono)',
            fontWeight: 600, textAlign: 'center', letterSpacing: '0.05em',
            outline: 'none', marginBottom: 8,
          }}
        />

        {error && (
          <p style={{ fontSize: 12, color: 'var(--red)', marginBottom: 8 }}>
            Invalid license key
          </p>
        )}

        <button
          onClick={handleActivate}
          disabled={loading || !key.trim()}
          style={{
            width: '100%', padding: 13, borderRadius: 10,
            background: 'var(--blue)', color: '#fff',
            fontSize: 15, fontWeight: 700, border: 'none', cursor: 'pointer',
            opacity: loading || !key.trim() ? 0.5 : 1,
            marginTop: 4,
          }}
        >
          {loading ? 'Verifying...' : 'Activate'}
        </button>

        <p style={{ fontSize: 10, color: 'var(--gray-3)', marginTop: 16 }}>
          Format: QS-XXXX-XXXX-XXXX-XXXX-XXXX
        </p>
      </div>
    </div>
  )
}

export function SocketProvider({ children }) {
  const [state, setState] = useState(null)
  const [announced, setAnnounced] = useState(null)
  const socketRef = useRef(null)

  useEffect(() => {
    const socket = io({ transports: ['websocket', 'polling'] })
    socketRef.current = socket

    socket.on('state:sync', (data) => setState(data))
    socket.on('ticket:announced', (data) => setAnnounced(data))

    return () => socket.disconnect()
  }, [])

  const emit = (event, data, timeoutMs = 5000) => {
    return new Promise((resolve) => {
      const sock = socketRef.current
      if (!sock) { resolve(null); return }
      let settled = false
      const timer = setTimeout(() => {
        if (settled) return
        settled = true
        resolve(null)
      }, timeoutMs)
      sock.emit(event, data, (result) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        resolve(result)
      })
    })
  }

  const emitVoid = (event, data) => {
    socketRef.current?.emit(event, data)
  }

  if (!state) {
    return (
      <div style={{
        height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: 'var(--gray-2)', fontFamily: 'var(--font)', fontSize: '14px',
      }}>
        Connecting...
      </div>
    )
  }

  if (!state.licensed) {
    return <LicenseGate emit={emit} onActivated={() => {}} />
  }

  return (
    <Ctx.Provider value={{ state, announced, emit, emitVoid }}>
      {children}
    </Ctx.Provider>
  )
}

export function useSocket() {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useSocket must be inside SocketProvider')
  return ctx
}
