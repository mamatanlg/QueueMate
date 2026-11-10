import { useEffect, useRef } from 'react'
import { useSocket } from '../context/SocketContext'
import { playChime } from '../utils/sounds'
import { t, translateRoom, LANGUAGES } from '../utils/i18n'
import { speakSequential, stopAll } from '../hooks/useVoice'

const SUPPORTED_LANGS = new Set(LANGUAGES.map(l => l.code))

export default function VoiceAnnouncer() {
  const { state, announced } = useSocket()
  const queueRef = useRef([])
  const processingRef = useRef(false)
  const seenKeysRef = useRef(new Set())
  const settingsRef = useRef(state.settings)

  // Keep latest settings accessible to the async processor
  useEffect(() => { settingsRef.current = state.settings }, [state.settings])

  // Process the queue one announcement at a time
  const processQueue = async () => {
    if (processingRef.current) return
    processingRef.current = true

    while (queueRef.current.length > 0) {
      const item = queueRef.current.shift()
      const { soundTheme = 'doorbell', languages: rawLangs = ['en', 'ar'], volume = 0.8 } = settingsRef.current
      // Strip any languages no longer in the supported set (legacy settings
      // could still hold 'ur' / 'fr').
      const languages = rawLangs.filter(code => SUPPORTED_LANGS.has(code))
      if (languages.length === 0) continue

      try {
        stopAll()
        await playChime(soundTheme, volume)
        await new Promise(r => setTimeout(r, 500))

        for (let i = 0; i < languages.length; i++) {
          const lang = languages[i]
          const counterTranslated = translateRoom(item.counterName || '', lang)
          const stageTranslated = translateRoom(item.stageName || '', lang)
          // Pick the localized category name; fall back to English then '' so
          // a missing translation doesn't break the sentence.
          const categoryLocalized = item.categoryNames?.[lang] || item.categoryNames?.en || ''
          // Pick template by action: 'advance' = patient moving to a new stage,
          // 'recall' = repeat call, default = first call. Use the *Cat variant
          // only when we actually have a category — an empty {category} would
          // leave a leading comma in Arabic ("،  رقم …").
          const baseKey = item.action === 'recall'
            ? 'voiceRecall'
            : item.action === 'advance'
              ? 'voiceAdvance'
              : 'voiceNowServing'
          const textKey = categoryLocalized ? `${baseKey}Cat` : baseKey
          // Convert digits to Arabic-Indic for Arabic so the voice doesn't read them in English
          let ticketNum = String(item.ticketNumber)
          if (lang === 'ar') {
            const ar = ['٠','١','٢','٣','٤','٥','٦','٧','٨','٩']
            ticketNum = ticketNum.replace(/\d/g, d => ar[d])
          }
          const params = {
            n: ticketNum,
            counter: counterTranslated,
            stage: stageTranslated,
            category: categoryLocalized,
          }
          // Admin can override the next/recall templates per language in
          // Settings → Sound & Voice. Empty string = use the built-in
          // i18n template. Advance/finish announcements aren't customizable.
          const customKey = item.action === 'recall' ? 'recall' : item.action === 'next' ? 'next' : null
          const customText = customKey ? settingsRef.current?.voiceTexts?.[customKey]?.[lang] : null
          let text
          if (customText && customText.trim()) {
            text = customText
            for (const [k, v] of Object.entries(params)) {
              text = text.split(`{${k}}`).join(v ?? '')
            }
          } else {
            text = t(textKey, lang, params)
          }

          window.speechSynthesis?.cancel()
          await speakSequential(text, lang, settingsRef.current)

          if (i < languages.length - 1) {
            await new Promise(r => setTimeout(r, 800))
          }
        }

        // Pause between separate announcements so they don't run together
        if (queueRef.current.length > 0) {
          await new Promise(r => setTimeout(r, 600))
        }
      } catch (e) {
        console.error('Voice announcement failed:', e)
      }
    }

    processingRef.current = false
  }

  // When a new announcement arrives, queue it and kick the processor
  useEffect(() => {
    if (!announced) return

    const key = `${announced.ticketNumber}-${announced.action}-${announced.counterId}-${announced.at || announced.calledAt || ''}`
    if (seenKeysRef.current.has(key)) return
    seenKeysRef.current.add(key)
    // Trim memory of seen keys
    if (seenKeysRef.current.size > 200) {
      seenKeysRef.current = new Set(Array.from(seenKeysRef.current).slice(-100))
    }

    // Resolve the localized category names at enqueue time so the async
    // processor doesn't depend on still-fresh state.categories. Server
    // attaches categoryId to every ticket:announced event.
    const cat = state.categories.find(c => c.id === announced.categoryId)
    const categoryNames = cat ? {
      en: cat.name,
      ar: cat.nameAr || cat.name,
      ur: cat.nameUr || cat.name,
      fr: cat.nameFr || cat.name,
    } : null

    queueRef.current.push({
      ticketNumber: announced.ticketNumber,
      action: announced.action,
      counterId: announced.counterId,
      counterName: announced.counterName,
      stageName: announced.stageName,
      categoryNames,
    })

    processQueue()
  }, [announced])

  return null
}
