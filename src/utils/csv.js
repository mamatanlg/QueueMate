export function ticketsToCSV(tickets, categories) {
  const catMap = Object.fromEntries(categories.map(c => [c.id, c.name]))
  const header = ['Number', 'Category', 'Priority', 'Status', 'Counter', 'Created', 'Called', 'Completed', 'Wait (s)', 'Service (s)', 'Notes']

  const rows = tickets.map(t => {
    const waitTime = t.calledAt ? Math.round((t.calledAt - t.createdAt) / 1000) : ''
    const serviceTime = t.calledAt && t.completedAt ? Math.round((t.completedAt - t.calledAt) / 1000) : ''
    return [
      t.number,
      catMap[t.categoryId] || t.categoryId,
      t.priority,
      t.status,
      t.counterId || '',
      new Date(t.createdAt).toLocaleString(),
      t.calledAt ? new Date(t.calledAt).toLocaleString() : '',
      t.completedAt ? new Date(t.completedAt).toLocaleString() : '',
      waitTime,
      serviceTime,
      `"${(t.notes || '').replace(/"/g, '""')}"`,
    ]
  })

  return [header, ...rows].map(r => r.join(',')).join('\n')
}

export function downloadCSV(csvString, filename = 'queue-export.csv') {
  const blob = new Blob([csvString], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
