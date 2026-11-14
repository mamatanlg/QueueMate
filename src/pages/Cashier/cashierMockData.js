export const demoCredentials = {
  username: 'cashier1',
  password: 'QueueMateDemo!',
}

export const demoCashier = {
  name: 'Maria Santos',
  role: 'Cashier',
  windowNumber: 1,
  windowName: 'Window 1',
}

export function createInitialQueue() {
  return [
    { id: 'ticket-1043', number: '043', type: 'Payment', issuedAt: '09:42 AM' },
    { id: 'ticket-1044', number: '044', type: 'SOA', issuedAt: '09:45 AM' },
    { id: 'ticket-1045', number: '045', type: 'Other Transactions', issuedAt: '09:48 AM' },
    { id: 'ticket-1046', number: '046', type: 'Payment', issuedAt: '09:51 AM' },
    { id: 'ticket-1047', number: '047', type: 'SOA', issuedAt: '09:54 AM' },
  ]
}

export const initialCurrentTicket = {
  id: 'ticket-1042',
  number: '042',
  type: 'SOA',
  calledAt: '09:39 AM',
}

export const initialActivity = [
  { id: 'activity-1', action: 'Completed', number: '041', type: 'Payment', time: '09:38 AM' },
  { id: 'activity-2', action: 'Called', number: '042', type: 'SOA', time: '09:39 AM' },
  { id: 'activity-3', action: 'Issued', number: '047', type: 'SOA', time: '09:54 AM' },
]

export const initialDailyStats = {
  completed: 18,
  skipped: 2,
  servedToday: 21,
}
