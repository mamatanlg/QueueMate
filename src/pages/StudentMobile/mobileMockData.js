import { createInitialQueue, initialCurrentTicket } from '../Cashier/cashierMockData'

export const displayWindows = [
  { number: 1, status: 'Available', ticket: '042' },
  { number: 2, status: 'Available', ticket: '039' },
  { number: 3, status: 'Available', ticket: null },
  { number: 4, status: 'Unavailable', ticket: null },
]

export const latestQueueNumber = '047'

export const mobileTransactionTypes = [
  ...new Set([initialCurrentTicket.type, ...createInitialQueue().map((ticket) => ticket.type)]),
]
