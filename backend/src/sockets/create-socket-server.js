import { Server } from 'socket.io'
import { createCorsOrigin } from '../config/cors.js'
import { config } from '../config/env.js'
import { registerSocketHandlers } from './register-handlers.js'

export function createSocketServer(httpServer) {
  const io = new Server(httpServer, {
    cors: {
      origin: createCorsOrigin(config.clientOrigins),
      methods: ['GET', 'POST'],
    },
  })

  registerSocketHandlers(io)
  return io
}
