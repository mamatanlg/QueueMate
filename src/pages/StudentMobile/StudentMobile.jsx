import { useCallback, useEffect, useRef, useState } from 'react'
import QrScanner from 'qr-scanner'
import {
  displayWindows,
  latestQueueNumber,
  mobileTransactionTypes,
  queueEntryAccessCode,
} from './mobileMockData'
import './StudentMobile.css'

function Brand() {
  return (
    <header className="student-mobile__header">
      <a className="student-mobile__brand" href="/mobile" aria-label="QueueMate home">
        <span className="student-mobile__brand-mark">Q</span>
        <span>Queue<span>Mate</span></span>
      </a>
      <span className="student-mobile__school">SAN ISIDRO COLLEGE</span>
    </header>
  )
}

function Scanner({ error, onCode, onCancel }) {
  const videoRef = useRef(null)
  const [message, setMessage] = useState('')

  useEffect(() => {
    let cancelled = false
    let scanTimer
    const video = videoRef.current
    if (!video) return undefined

    const scanner = new QrScanner(
      video,
      (result) => {
        window.clearTimeout(scanTimer)
        scanner.stop()
        onCode(result.data)
      },
      {
        preferredCamera: 'environment',
        returnDetailedScanResult: true,
        onDecodeError: () => {},
      },
    )
    scanner.start().then(() => {
      if (!cancelled) {
        scanTimer = window.setTimeout(() => {
          setMessage('We could not read the QR code yet. Adjust your camera or enter the code manually.')
        }, 20000)
      }
    }).catch((error) => {
      if (cancelled) return
      const errorName = error?.name || ''
      const errorText = error instanceof Error ? error.message : String(error)
      if (/NotAllowed|PermissionDenied/i.test(errorName) || /permission|denied/i.test(errorText)) {
        setMessage('Camera permission was denied. Allow camera access in your browser settings or enter the code manually.')
      } else if (/NotFound|DevicesNotFound/i.test(errorName) || /no camera|device not found/i.test(errorText)) {
        setMessage('No camera was found. Enter the code shown on the TV instead.')
      } else {
        setMessage('The camera could not be started. Try again or enter the code manually.')
      }
    })
    return () => {
      cancelled = true
      window.clearTimeout(scanTimer)
      scanner.stop()
      scanner.destroy()
    }
  }, [onCode])

  return (
    <section className="student-mobile__screen">
      <button className="student-mobile__back" type="button" onClick={onCancel}>← Cancel scanning</button>
      <div className="student-mobile__intro">
        <span className="student-mobile__eyebrow">GET STARTED</span>
        <h1>Scan the TV code</h1>
        <p>Point your camera at the QueueMate QR code on the Business Office display.</p>
      </div>
      <div className="student-mobile__camera">
        <video ref={videoRef} autoPlay muted playsInline aria-label="QR code camera preview" />
        <span className="student-mobile__camera-frame" aria-hidden="true" />
        {!message && <span className="student-mobile__camera-hint">Place the QR code inside the frame</span>}
      </div>
      {(message || error) && (
        <p className="student-mobile__message student-mobile__message--error" role="status">
          {error || message}
        </p>
      )}
      <button className="student-mobile__text-button" type="button" onClick={onCancel}>
        Enter access code manually
      </button>
    </section>
  )
}

function WindowList() {
  return (
    <section className="student-mobile__windows" aria-label="Current serving numbers">
      <h2>Now serving</h2>
      {displayWindows.map((window) => (
        <div className="student-mobile__window-row" key={window.number}>
          <strong>Window {window.number}</strong>
          <span className="student-mobile__window-ticket">{window.ticket || '—'}</span>
          <span className={`student-mobile__window-status ${window.status === 'Unavailable' ? 'is-unavailable' : ''}`}>
            {window.ticket ? 'Serving' : window.status}
          </span>
        </div>
      ))}
    </section>
  )
}

function StudentMobile() {
  const [screen, setScreen] = useState('scanner')
  const [cameraActive, setCameraActive] = useState(false)
  const [accessCode, setAccessCode] = useState('')
  const [accessError, setAccessError] = useState('')
  const [selectedTransaction, setSelectedTransaction] = useState('')
  const [nextQueueNumber, setNextQueueNumber] = useState(Number(latestQueueNumber) + 1)
  const [ticket, setTicket] = useState(null)
  const [soundEnabled, setSoundEnabled] = useState(false)
  const [vibrationEnabled, setVibrationEnabled] = useState(false)
  const [alertFeedback, setAlertFeedback] = useState('')

  const validateAccessCode = useCallback((value) => {
    let code = value
    try {
      code = new URL(value).searchParams.get('code') || value
    } catch {
      // Manual entry is a plain access code, not a URL.
    }
    if (code.trim().toUpperCase() !== queueEntryAccessCode) {
      setAccessError('That access code is not valid. Check the code on the TV and try again.')
      return
    }
    setAccessError('')
    setCameraActive(false)
    setScreen('transactions')
  }, [])

  function continueWithCode(event) {
    event.preventDefault()
    validateAccessCode(accessCode)
  }

  function createTicket() {
    if (!selectedTransaction) return
    const number = String(nextQueueNumber).padStart(3, '0')
    setTicket({ number, transaction: selectedTransaction, status: 'Waiting' })
    setNextQueueNumber((current) => current + 1)
    setScreen('ticket')
  }

  function playSound() {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext
    if (!AudioContextClass) {
      setAlertFeedback('Sound alerts are not supported by this browser.')
      return
    }
    try {
      const audio = new AudioContextClass()
      const oscillator = audio.createOscillator()
      const gain = audio.createGain()
      oscillator.type = 'sine'
      oscillator.frequency.value = 880
      gain.gain.value = 0.13
      oscillator.connect(gain)
      gain.connect(audio.destination)
      oscillator.start()
      oscillator.stop(audio.currentTime + 0.18)
      oscillator.onended = () => audio.close()
      setAlertFeedback('Sound alert enabled. You can turn it off anytime.')
    } catch {
      setAlertFeedback('Sound could not be played. Check your device audio settings.')
    }
  }

  function toggleSound() {
    const nextEnabled = !soundEnabled
    setSoundEnabled(nextEnabled)
    if (nextEnabled) playSound()
    else setAlertFeedback('Sound alert turned off.')
  }

  function toggleVibration() {
    const nextEnabled = !vibrationEnabled
    setVibrationEnabled(nextEnabled)
    if (!('vibrate' in navigator)) {
      setAlertFeedback('Vibration is not supported by this device or browser.')
      return
    }
    if (nextEnabled) {
      navigator.vibrate(150)
      setAlertFeedback('Vibration alert enabled.')
    } else {
      navigator.vibrate(0)
      setAlertFeedback('Vibration alert turned off.')
    }
  }

  const currentServing = Math.max(...displayWindows.map((window) => Number(window.ticket) || 0))
  const numbersAhead = ticket ? Math.max(0, Number(ticket.number) - currentServing - 1) : 0
  const showTurnAlert = Boolean(ticket && numbersAhead > 0 && numbersAhead <= 5)

  return (
    <main className="student-mobile">
      <div className="student-mobile__phone">
        <Brand />
        {screen === 'scanner' && (
          cameraActive ? (
            <Scanner
              error={accessError}
              onCode={validateAccessCode}
              onCancel={() => setCameraActive(false)}
            />
          ) : (
            <section className="student-mobile__screen">
              <div className="student-mobile__welcome-mark" aria-hidden="true">⌗</div>
              <div className="student-mobile__intro">
                <span className="student-mobile__eyebrow">STUDENT &amp; PARENT APP</span>
                <h1>Join the queue</h1>
                <p>Scan the code displayed at the Business Office to get started.</p>
              </div>
              <button className="student-mobile__button student-mobile__button--primary" type="button" onClick={() => setCameraActive(true)}>
                <span aria-hidden="true">▦</span> Scan QR Code
              </button>
              <div className="student-mobile__divider"><span>OR</span></div>
              <button className="student-mobile__button student-mobile__button--secondary" type="button" onClick={() => { setAccessError(''); setScreen('manual') }}>
                Enter access code manually
              </button>
              <p className="student-mobile__privacy">Camera access is requested only when you choose to scan.</p>
            </section>
          )
        )}

        {screen === 'manual' && (
          <section className="student-mobile__screen">
            <button className="student-mobile__back" type="button" onClick={() => { setAccessError(''); setScreen('scanner') }}>← Back to scanner</button>
            <div className="student-mobile__intro">
              <span className="student-mobile__eyebrow">ALTERNATIVE ACCESS</span>
              <h1>Enter Access Code Manually</h1>
              <p>Find the short code beside the QR code on the TV display.</p>
            </div>
            <form className="student-mobile__form" onSubmit={continueWithCode}>
              <label htmlFor="mobile-access-code">TV access code</label>
              <input
                autoCapitalize="characters"
                autoComplete="off"
                id="mobile-access-code"
                maxLength={12}
                onChange={(event) => { setAccessCode(event.target.value); setAccessError('') }}
                placeholder="e.g. QM-47K2"
                value={accessCode}
              />
              {accessError && <p className="student-mobile__message student-mobile__message--error" role="alert">{accessError}</p>}
              <button className="student-mobile__button student-mobile__button--primary" type="submit">Continue</button>
            </form>
            <button className="student-mobile__text-button" type="button" onClick={() => { setAccessError(''); setScreen('scanner') }}>
              Return to QR scanner
            </button>
          </section>
        )}

        {screen === 'transactions' && (
          <section className="student-mobile__screen">
            <button className="student-mobile__back" type="button" onClick={() => setScreen('scanner')}>← Back</button>
            <div className="student-mobile__intro">
              <span className="student-mobile__eyebrow">STEP 2 OF 2</span>
              <h1>Select a transaction</h1>
              <p>Choose the service you need today.</p>
            </div>
            <div className="student-mobile__transaction-list" role="radiogroup" aria-label="Transaction type">
              {mobileTransactionTypes.map((transaction) => (
                <button
                  aria-checked={selectedTransaction === transaction}
                  className={`student-mobile__transaction ${selectedTransaction === transaction ? 'is-selected' : ''}`}
                  key={transaction}
                  onClick={() => setSelectedTransaction(transaction)}
                  role="radio"
                  type="button"
                >
                  <span className="student-mobile__transaction-radio" />
                  <span>{transaction}</span>
                  <span aria-hidden="true">›</span>
                </button>
              ))}
            </div>
            <button
              className="student-mobile__button student-mobile__button--primary"
              disabled={!selectedTransaction}
              onClick={createTicket}
              type="button"
            >
              Get queue number
            </button>
          </section>
        )}

        {screen === 'ticket' && ticket && (
          <section className="student-mobile__screen">
            <span className="student-mobile__eyebrow">YOUR QUEUE TICKET</span>
            <div className="student-mobile__ticket-number">{ticket.number}</div>
            <div className="student-mobile__ticket-summary">
              <span>{ticket.transaction}</span>
              <strong>{ticket.status}</strong>
            </div>
            <div className="student-mobile__assigned">
              <span>Assigned window</span>
              <strong>Not assigned yet</strong>
            </div>
            <WindowList />
            <p className="student-mobile__instructions">Please watch the display and proceed to your assigned window when your number is called.</p>
            <button className="student-mobile__button student-mobile__button--primary" onClick={() => setScreen('monitor')} type="button">
              Monitor my queue
            </button>
          </section>
        )}

        {screen === 'monitor' && ticket && (
          <section className="student-mobile__screen">
            <button className="student-mobile__back" type="button" onClick={() => setScreen('ticket')}>← Back to ticket</button>
            <span className="student-mobile__eyebrow">QUEUE MONITOR</span>
            <h1 className="student-mobile__monitor-title">Your number</h1>
            <div className="student-mobile__monitor-number">{ticket.number}</div>
            <div className="student-mobile__ticket-summary">
              <span>{ticket.transaction}</span>
              <strong>{ticket.status}</strong>
            </div>
            {showTurnAlert && (
              <aside className="student-mobile__turn-alert" role="status">
                <strong>Your turn is getting close!</strong>
                <span>{numbersAhead} {numbersAhead === 1 ? 'number' : 'numbers'} remain before your turn.</span>
              </aside>
            )}
            <WindowList />
            <section className="student-mobile__alert-settings" aria-label="Alert options">
              <h2>Alert options</h2>
              <p>In-app alerts work without notification permission. Optional sound and vibration depend on your device.</p>
              <div>
                <button className={`student-mobile__toggle ${soundEnabled ? 'is-enabled' : ''}`} onClick={toggleSound} type="button" aria-pressed={soundEnabled}>
                  {soundEnabled ? 'Sound on' : 'Enable sound'}
                </button>
                <button className={`student-mobile__toggle ${vibrationEnabled ? 'is-enabled' : ''}`} onClick={toggleVibration} type="button" aria-pressed={vibrationEnabled}>
                  {vibrationEnabled ? 'Vibration on' : 'Enable vibration'}
                </button>
              </div>
              {alertFeedback && <p className="student-mobile__feedback" role="status">{alertFeedback}</p>}
            </section>
            <button className="student-mobile__text-button" onClick={() => setScreen('ticket')} type="button">Return to my ticket</button>
          </section>
        )}
      </div>
      <div className="student-mobile__desktop-restriction">
        Please use a mobile phone to access QueueMate.
      </div>
    </main>
  )
}

export default StudentMobile
