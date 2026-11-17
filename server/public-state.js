export function getPublicState(state, licensed) {
  const { elevenLabsApiKey: _elevenLabsApiKey, ...settings } = state.settings

  return {
    licensed,
    counters: state.counters,
    categories: state.categories,
    tickets: state.tickets,
    nextTicketNumber: state.nextTicketNumber,
    announcements: state.announcements,
    settings,
    branches: state.branches,
    activeBranch: state.activeBranch,
    auditLog: state.auditLog.slice(0, 100),
    shifts: state.shifts.slice(-50),
    roles: {
      hasAdmin: !!state.roles.adminPassword,
      hasOperator: !!state.roles.operatorPassword,
    },
  }
}
