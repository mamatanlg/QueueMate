import { useContext } from 'react'
import { Ctx } from '../context/socket-context'

export function useSocket() {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useSocket must be inside SocketProvider')
  return ctx
}
