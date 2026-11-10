import { useEffect } from 'react'
import { useSocket } from '../context/SocketContext'

export default function ThemeApplier() {
  const { state } = useSocket()

  // Theme + accent color
  useEffect(() => {
    const { theme, accentColor } = state.settings
    document.documentElement.setAttribute('data-theme', theme || 'light')
    if (accentColor) {
      document.documentElement.style.setProperty('--blue', accentColor)
      // Expand short hex (#abc → #aabbcc) and only set --blue-dim if we got a valid hex.
      let hex = accentColor.replace('#', '')
      if (hex.length === 3) hex = hex.split('').map(ch => ch + ch).join('')
      if (/^[0-9a-f]{6}$/i.test(hex)) {
        const r = parseInt(hex.slice(0, 2), 16)
        const g = parseInt(hex.slice(2, 4), 16)
        const b = parseInt(hex.slice(4, 6), 16)
        document.documentElement.style.setProperty('--blue-dim', `rgba(${r}, ${g}, ${b}, 0.12)`)
      }
    }
  }, [state.settings.theme, state.settings.accentColor])

  // Custom CSS
  useEffect(() => {
    let style = document.getElementById('queue-custom-css')
    if (!style) {
      style = document.createElement('style')
      style.id = 'queue-custom-css'
      document.head.appendChild(style)
    }
    style.textContent = state.settings.customCSS || ''
  }, [state.settings.customCSS])

  // Background theme
  useEffect(() => {
    document.documentElement.setAttribute('data-bg', state.settings.backgroundTheme || 'none')
  }, [state.settings.backgroundTheme])

  return null
}
