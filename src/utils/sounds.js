let audioCtx = null
let masterGain = null

function ctx() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)()
    // Master gain — playChime sets this from the user's volume setting so the
    // slider actually changes loudness instead of being purely cosmetic.
    masterGain = audioCtx.createGain()
    masterGain.gain.value = 1
    masterGain.connect(audioCtx.destination)
  }
  return audioCtx
}

// Browsers (especially Chrome/Safari) don't allow audio playback until the
// user has interacted with the page. The Display tab is often opened standalone
// so first call to playChime can fall on a suspended context — silent. This
// hooks a one-time gesture listener that resumes the context and warms the
// audio pipeline; call once when Display mounts.
let primed = false
export function primeAudio() {
  if (primed) return
  const onGesture = () => {
    primed = true
    try {
      const c = ctx()
      if (c.state === 'suspended') c.resume().catch(() => {})
    } catch {}
    // Also force an HTMLAudioElement to play a silent buffer so subsequent
    // <Audio> playback (used by the ElevenLabs/Google paths) doesn't get
    // blocked by the same autoplay policy.
    try {
      const a = new Audio('data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA')
      a.play().catch(() => {})
    } catch {}
    window.removeEventListener('click', onGesture, true)
    window.removeEventListener('keydown', onGesture, true)
    window.removeEventListener('touchstart', onGesture, true)
  }
  window.addEventListener('click', onGesture, true)
  window.addEventListener('keydown', onGesture, true)
  window.addEventListener('touchstart', onGesture, true)
}

// Generate high-quality sounds using Web Audio with convolution reverb for realism
function createReverb(c, duration = 1.5) {
  const conv = c.createConvolver()
  const rate = c.sampleRate
  const len = rate * duration
  const buf = c.createBuffer(2, len, rate)
  for (let ch = 0; ch < 2; ch++) {
    const data = buf.getChannelData(ch)
    for (let i = 0; i < len; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.5)
    }
  }
  conv.buffer = buf
  // Connect reverb output to the master so the wet signal is actually audible.
  conv.connect(masterGain)
  return conv
}

function bell(c, freq, time, dur, vol, reverb) {
  // Fundamental + partials for metallic bell sound
  const partials = [1, 2.76, 5.4, 8.93]
  const vols = [vol, vol * 0.4, vol * 0.15, vol * 0.06]
  let last
  partials.forEach((p, i) => {
    const o = c.createOscillator()
    const g = c.createGain()
    o.type = 'sine'
    o.frequency.setValueAtTime(freq * p, time)
    g.gain.setValueAtTime(0, time)
    g.gain.linearRampToValueAtTime(vols[i], time + 0.005)
    g.gain.exponentialRampToValueAtTime(0.0001, time + dur * (1 - i * 0.15))
    o.connect(g)
    if (reverb) g.connect(reverb)
    g.connect(masterGain)
    o.start(time)
    o.stop(time + dur)
    last = o
  })
  return last
}

function tone(c, freq, time, dur, type, vol) {
  const o = c.createOscillator()
  const g = c.createGain()
  o.type = type
  o.frequency.setValueAtTime(freq, time)
  g.gain.setValueAtTime(0, time)
  g.gain.linearRampToValueAtTime(vol, time + 0.01)
  g.gain.setValueAtTime(vol, time + dur * 0.4)
  g.gain.exponentialRampToValueAtTime(0.0001, time + dur)
  o.connect(g)
  g.connect(masterGain)
  o.start(time)
  o.stop(time + dur)
  return o
}

const themes = {
  // Classic ding-dong — real doorbell with bell partials + reverb
  doorbell: (c) => {
    const rev = createReverb(c, 1.2)
    bell(c, 830, c.currentTime, 0.7, 0.18, rev)
    return bell(c, 622, c.currentTime + 0.4, 0.9, 0.2, rev)
  },

  // Hotel lobby — soft 3-note ascending with reverb
  hotel: (c) => {
    const rev = createReverb(c, 2)
    bell(c, 523, c.currentTime, 0.6, 0.1, rev)
    bell(c, 659, c.currentTime + 0.25, 0.6, 0.1, rev)
    return bell(c, 784, c.currentTime + 0.5, 0.8, 0.12, rev)
  },

  // Airport PA — the classic two-tone before announcements
  airport: (c) => {
    const rev = createReverb(c, 1)
    tone(c, 932, c.currentTime, 0.35, 'sine', 0.2)
    tone(c, 932, c.currentTime, 0.35, 'triangle', 0.06)
    tone(c, 698, c.currentTime + 0.35, 0.5, 'sine', 0.22)
    return tone(c, 698, c.currentTime + 0.35, 0.5, 'triangle', 0.06)
  },

  // Hospital — single gentle ping with long tail
  hospital: (c) => {
    const rev = createReverb(c, 2.5)
    return bell(c, 1047, c.currentTime, 1.5, 0.08, rev)
  },

  // Bank counter — crisp double beep
  bank: (c) => {
    tone(c, 1000, c.currentTime, 0.08, 'sine', 0.25)
    return tone(c, 1000, c.currentTime + 0.14, 0.08, 'sine', 0.25)
  },

  // Westminster — Big Ben 4-note chime
  westminster: (c) => {
    const rev = createReverb(c, 2.5)
    const notes = [659, 587, 523, 392]
    let last
    notes.forEach((f, i) => {
      last = bell(c, f, c.currentTime + i * 0.5, 0.8, 0.1, rev)
    })
    return last
  },

  // Crystal — glass-like bright bell
  crystal: (c) => {
    const rev = createReverb(c, 2)
    bell(c, 2093, c.currentTime, 0.8, 0.06, rev)
    bell(c, 1568, c.currentTime, 1.2, 0.08, rev)
    return bell(c, 1047, c.currentTime, 1.5, 0.1, rev)
  },

  // Zen — meditation bowl, deep and sustained
  zen: (c) => {
    const rev = createReverb(c, 3)
    bell(c, 220, c.currentTime, 2.5, 0.12, rev)
    bell(c, 330, c.currentTime + 0.01, 2, 0.06, rev)
    return bell(c, 440, c.currentTime + 0.02, 1.5, 0.04, rev)
  },

  // Marimba — warm wooden mallet hit
  marimba: (c) => {
    const hit = (freq, time, vol) => {
      const o = c.createOscillator()
      const g = c.createGain()
      o.type = 'sine'
      o.frequency.setValueAtTime(freq, time)
      g.gain.setValueAtTime(vol, time)
      g.gain.exponentialRampToValueAtTime(0.0001, time + 0.4)
      o.connect(g)
      g.connect(masterGain)
      // Add sub-octave for warmth
      const o2 = c.createOscillator()
      o2.type = 'sine'
      o2.frequency.setValueAtTime(freq / 2, time)
      const g2 = c.createGain()
      g2.gain.setValueAtTime(vol * 0.5, time)
      g2.gain.exponentialRampToValueAtTime(0.0001, time + 0.6)
      o2.connect(g2)
      g2.connect(masterGain)
      o.start(time); o.stop(time + 0.5)
      o2.start(time); o2.stop(time + 0.7)
      return o
    }
    hit(784, c.currentTime, 0.25)
    hit(988, c.currentTime + 0.12, 0.25)
    return hit(1175, c.currentTime + 0.24, 0.2)
  },

  // Harp — gentle plucked string
  harp: (c) => {
    const rev = createReverb(c, 2)
    const pluck = (freq, time, vol) => {
      const o = c.createOscillator()
      const g = c.createGain()
      o.type = 'triangle'
      o.frequency.setValueAtTime(freq, time)
      o.frequency.exponentialRampToValueAtTime(freq * 0.998, time + 1)
      g.gain.setValueAtTime(vol, time)
      g.gain.exponentialRampToValueAtTime(0.0001, time + 1.2)
      o.connect(g)
      g.connect(rev)
      g.connect(masterGain)
      o.start(time)
      o.stop(time + 1.3)
      return o
    }
    pluck(523, c.currentTime, 0.18)
    pluck(659, c.currentTime + 0.15, 0.16)
    return pluck(784, c.currentTime + 0.3, 0.14)
  },

  // Modern — tech notification, clean and crisp
  modern: (c) => {
    tone(c, 880, c.currentTime, 0.08, 'sine', 0.2)
    tone(c, 1109, c.currentTime + 0.1, 0.08, 'sine', 0.2)
    return tone(c, 1319, c.currentTime + 0.2, 0.2, 'sine', 0.18)
  },

  // Orchestra hit — dramatic announcement
  orchestra: (c) => {
    const rev = createReverb(c, 2)
    const freqs = [262, 330, 392, 523]
    let last
    freqs.forEach(f => {
      last = bell(c, f, c.currentTime, 1.2, 0.06, rev)
      tone(c, f, c.currentTime, 0.15, 'sawtooth', 0.04)
    })
    return last
  },
}

export const SOUND_THEMES = Object.keys(themes)

export async function playChime(theme = 'doorbell', volume = 0.8) {
  try {
    const c = ctx()
    // Browsers suspend AudioContext after the tab is backgrounded; await so
    // oscillators don't schedule against a stalled clock and play silently.
    if (c.state === 'suspended') {
      try { await c.resume() } catch {}
    }
    // Apply volume via master gain. Guard against undefined / NaN — those
    // would silence everything by writing NaN to the gain param.
    const v = (typeof volume === 'number' && !isNaN(volume))
      ? Math.max(0, Math.min(1, volume))
      : 0.8
    masterGain.gain.setValueAtTime(v, c.currentTime)
    const themeFunc = themes[theme] || themes.doorbell
    const osc = themeFunc(c)
    return await new Promise(resolve => {
      if (osc) osc.onended = resolve
      else setTimeout(resolve, 2000)
    })
  } catch {
    // swallow — never let an audio failure break the announcement queue
  }
}
