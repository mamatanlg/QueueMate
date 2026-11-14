import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react'
import { AuthContext } from './auth-context'
import { ApiError, apiRequest } from '../services/api'

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null)
  const [sessionNotice, setSessionNotice] = useState('')

  const signIn = useCallback(async (username, password) => {
    const result = await apiRequest('/auth/login', {
      method: 'POST',
      body: { username, password },
    })

    const role = result?.role
    const profile = role === 'admin' ? result.admin
      : role === 'cashier' ? result.cashier
        : null
    const expiresIn = Number(result?.expiresIn)
    if (!result?.accessToken || !profile || !Number.isFinite(expiresIn) || expiresIn <= 0) {
      throw new ApiError('The backend returned an invalid login response.', 502)
    }

    const nextSession = {
      accessToken: result.accessToken,
      role,
      profile,
      expiresAt: Date.now() + expiresIn * 1000,
    }
    setSessionNotice('')
    setSession(nextSession)
    return nextSession
  }, [])

  const request = useCallback(async (path, options = {}) => {
    if (!session || session.expiresAt <= Date.now()) {
      setSession(null)
      throw new ApiError('Your session has expired. Please sign in again.', 401)
    }

    try {
      return await apiRequest(path, { ...options, token: session.accessToken })
    } catch (error) {
      if (error.status === 401) {
        setSessionNotice('Your session expired or is no longer active. Please sign in again.')
        setSession(null)
      }
      throw error
    }
  }, [session])

  const signOut = useCallback(async () => {
    if (!session) return
    try {
      await apiRequest('/auth/logout', {
        method: 'POST',
        token: session.accessToken,
      })
    } finally {
      setSession(null)
      setSessionNotice('')
    }
  }, [session])

  useEffect(() => {
    if (!session) return undefined
    const remaining = Math.max(0, session.expiresAt - Date.now())
    const timer = window.setTimeout(() => {
      setSessionNotice('Your session has expired. Please sign in again.')
      setSession(null)
    }, remaining)
    return () => window.clearTimeout(timer)
  }, [session])

  const value = useMemo(() => ({
    session,
    sessionNotice,
    signIn,
    signOut,
    request,
  }), [session, sessionNotice, signIn, signOut, request])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
