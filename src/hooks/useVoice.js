import { getLangCode } from '../utils/i18n'

let currentAudio = null
let aborted = false

function stopAll() {
  aborted = true
  window.speechSynthesis?.cancel()
  if (currentAudio) {
    currentAudio.pause()
    currentAudio.removeAttribute('src')
    currentAudio.load()
    currentAudio = null
  }
}

// ---- ElevenLabs TTS via server (keeps API key server-side) ----
async function speakElevenLabs(text) {
  const response = await fetch('/api/tts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  })

  if (!response.ok) {
    throw new Error(`TTS error: ${response.status}`)
  }

  const blob = await response.blob()
  const url = URL.createObjectURL(blob)

  return new Promise((resolve, reject) => {
    const audio = new Audio(url)
    currentAudio = audio
    audio.volume = 1
    let settled = false
    const finish = (err) => {
      if (settled) return
      settled = true
      currentAudio = null
      URL.revokeObjectURL(url)
      err ? reject(err) : resolve()
    }
    audio.addEventListener('ended', () => finish(), { once: true })
    audio.addEventListener('error', () => finish(new Error('Audio playback failed')), { once: true })
    audio.play().catch(e => finish(e))
  })
}

// ---- Fetch available voices from server (uses server-stored API key) ----
export async function fetchElevenLabsVoices() {
  try {
    const response = await fetch('/api/tts/voices')
    if (!response.ok) return []
    const data = await response.json()
    return data.voices || []
  } catch {
    return []
  }
}

function speakGoogle(text, lang) {
  return new Promise((resolve) => {
    aborted = false
    try {
      const url = `https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=${lang}&q=${encodeURIComponent(text)}`
      const audio = new Audio(url)
      currentAudio = audio
      audio.volume = 1

      let settled = false
      const finish = () => {
        if (settled) return
        settled = true
        currentAudio = null
        resolve()
      }

      audio.addEventListener('ended', finish, { once: true })
      audio.addEventListener('error', () => {
        if (settled) return
        settled = true
        currentAudio = null
        speakWeb(text, lang).then(resolve)
      }, { once: true })

      audio.play().catch(() => {
        if (settled) return
        settled = true
        currentAudio = null
        speakWeb(text, lang).then(resolve)
      })
    } catch {
      speakWeb(text, lang).then(resolve)
    }
  })
}

function speakWeb(text, lang) {
  return new Promise((resolve) => {
    if (!window.speechSynthesis) { resolve(); return }

    window.speechSynthesis.cancel()

    const langCode = getLangCode(lang)
    const u = new SpeechSynthesisUtterance(text)
    u.lang = langCode
    u.rate = 0.9
    u.volume = 1

    const voices = window.speechSynthesis.getVoices()
    const matching = voices.filter(v => v.lang.startsWith(lang) || v.lang.startsWith(langCode.split('-')[0]))
    const best = matching.find(v =>
      /Google|Microsoft|Premium|Enhanced|Natural|Samira|Majed|Maged/i.test(v.name)
    ) || matching[0]
    if (best) u.voice = best

    let settled = false
    const finish = () => {
      if (settled) return
      settled = true
      resolve()
    }
    u.onend = finish
    u.onerror = finish
    const timeout = setTimeout(finish, 10000)
    const origFinish = finish
    u.onend = () => { clearTimeout(timeout); origFinish() }
    u.onerror = () => { clearTimeout(timeout); origFinish() }

    window.speechSynthesis.speak(u)
  })
}

// Speak one language, using ElevenLabs if configured, else Google → Web fallback
async function speakSequential(text, lang, settings = {}) {
  aborted = false

  // Try ElevenLabs first if configured
  if (settings.ttsProvider === 'elevenlabs' && settings.elevenLabsApiKey) {
    try {
      await speakElevenLabs(text)
      await new Promise(r => setTimeout(r, 200))
      return
    } catch (e) {
      console.warn('ElevenLabs failed, falling back to Google:', e.message)
    }
  }

  // Fallback to Google TTS → Web Speech
  await speakGoogle(text, lang)
  await new Promise(r => setTimeout(r, 200))
}

export async function testSpeak(text, lang, settings = {}) {
  stopAll()
  await new Promise(r => setTimeout(r, 100))
  await speakSequential(text, lang, settings)
}

export { speakSequential, stopAll, speakElevenLabs }
