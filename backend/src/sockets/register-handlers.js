export function registerSocketHandlers(io) {
  io.on('connection', (socket) => {
    socket.data.connectedAt = Date.now()
  })
}
