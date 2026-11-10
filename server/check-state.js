import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'

const s = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } })

const [counters, tickets, categories] = await Promise.all([
  s.from('counters').select('*').order('id'),
  s.from('tickets').select('*').order('number'),
  s.from('categories').select('*'),
])

console.log('=== Counters ===')
for (const c of counters.data || []) {
  console.log(`  ${c.name.padEnd(18)} stageId=${(c.stage_id || 'NULL').padEnd(14)} status=${c.status.padEnd(8)} operator=${c.operator_name || '(none)'} currentTicket=${c.current_ticket || '—'}`)
}

console.log('\n=== Tickets ===')
for (const t of tickets.data || []) {
  const cat = categories.data?.find(c => c.id === t.category_id)
  const stage = cat?.stages?.[t.current_stage || 0]
  console.log(`  ${(t.display_number || t.number).toString().padEnd(8)} status=${t.status.padEnd(10)} stage=${stage?.id || '?'} (${stage?.name || '?'}) counter=${t.counter_id || '—'}`)
}
