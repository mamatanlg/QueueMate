import { displayWindows, latestQueueNumber, queueEntryAccessCode } from '../PublicDisplay/displayMockData'
import { createInitialQueue, initialCurrentTicket } from '../Cashier/cashierMockData'

export { displayWindows, latestQueueNumber, queueEntryAccessCode }

export const mobileTransactionTypes = [
  ...new Set([initialCurrentTicket.type, ...createInitialQueue().map((ticket) => ticket.type)]),
]
