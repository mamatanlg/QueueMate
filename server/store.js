import { readFileSync, writeFileSync, existsSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { createClient } from '@supabase/supabase-js'
import 'dotenv/config'
import { CLINIC_COUNTERS, CLINIC_CATEGORIES } from './clinic-setup.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const DATA_FILE = join(__dirname, 'data.json')

// ---- Supabase client (server-side, full access) ----
const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY
const supabase = (SUPABASE_URL && SUPABASE_KEY)
  ? createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } })
  : null

if (supabase) console.log('✓ Supabase client initialized')
else console.log('⚠ Supabase not configured — falling back to JSON file storage')

// ---- License Key Validation ----
const LICENSE_SECRET = 'QueueSys2026'

export function generateLicenseKey(seed) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  const hash = (s) => {
    let h = 0
    for (let i = 0; i < s.length; i++) { h = ((h << 5) - h + s.charCodeAt(i)) | 0 }
    return Math.abs(h)
  }
  const segments = []
  for (let seg = 0; seg < 4; seg++) {
    let part = ''
    for (let i = 0; i < 4; i++) {
      const h = hash(`${LICENSE_SECRET}-${seed}-${seg}-${i}`)
      part += chars[h % chars.length]
    }
    segments.push(part)
  }
  // Checksum segment
  const body = segments.join('')
  let check = ''
  for (let i = 0; i < 4; i++) {
    const h = hash(`${LICENSE_SECRET}-CHK-${body}-${i}`)
    check += chars[h % chars.length]
  }
  return `QS-${segments.join('-')}-${check}`
}

export function validateLicenseKey(key) {
  if (!key || typeof key !== 'string') return false
  const parts = key.trim().toUpperCase().split('-')
  if (parts.length !== 6 || parts[0] !== 'QS') return false
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  const hash = (s) => {
    let h = 0
    for (let i = 0; i < s.length; i++) { h = ((h << 5) - h + s.charCodeAt(i)) | 0 }
    return Math.abs(h)
  }
  // Validate checksum
  const body = parts.slice(1, 5).join('')
  if (body.length !== 16) return false
  let expectedCheck = ''
  for (let i = 0; i < 4; i++) {
    const h = hash(`${LICENSE_SECRET}-CHK-${body}-${i}`)
    expectedCheck += chars[h % chars.length]
  }
  return parts[5] === expectedCheck
}

function makeDefault() {
  return {
    license: 'QS-KJHG-JHGF-HGFE-GFED-STUV',
    counters: JSON.parse(JSON.stringify(CLINIC_COUNTERS)),
    categories: JSON.parse(JSON.stringify(CLINIC_CATEGORIES)),
    tickets: [],
    nextTicketNumber: 1,
    announcements: [],
    auditLog: [],
    shifts: [],
    roles: {
      adminPassword: '2811',
      operatorPassword: '',
      viewerPassword: '',
    },
    branches: [{ id: 'main', name: 'Main Branch', nameAr: 'الفرع الرئيسي' }],
    activeBranch: 'main',
    webhooks: [],
    settings: {
      soundTheme: 'doorbell',
      languages: ['ar', 'en'],
      uiLang: 'en',
      volume: 0.8,
      theme: 'light',
      accentColor: '#4f8ff7',
      logoUrl: '',
      mediaSlides: [],
      signageInterval: 10,
      idleTimeout: 0,
      smartRouting: false,
      floorMapEnabled: false,
      ttsProvider: 'elevenlabs',
      elevenLabsApiKey: 'sk_edd298b7eed05da619d536b6ea4d36e5157019b7dcc6cb72',
      elevenLabsVoiceId: 'A9ATTqUUQ6GHu0coCz8t',
      elevenLabsModel: 'eleven_multilingual_v2',
      backgroundTheme: 'none',
      customCSS: '',
      displayLayout: 'classic',
      // Per-language overrides for the spoken announcement. Empty string =
      // fall back to the built-in template in src/utils/i18n.js. Available
      // placeholders: {n} ticket number, {counter} counter name (translated),
      // {category} category name (localized).
      voiceTexts: {
        next: { en: '', ar: '' },
        recall: { en: '', ar: '' },
      },
    },
  }
}

// ---- Mappers between camelCase (app) and snake_case (DB) ----
// stage_id was originally a single TEXT column. To support a counter handling
// multiple stages (e.g. OPD also doing eye drops) we now store comma-separated
// stage IDs in the same column — no schema change required, and old single-
// value data round-trips cleanly.
const dbCounter = c => ({
  id: c.id, name: c.name, operator_name: c.operatorName || '',
  current_ticket: c.currentTicket, status: c.status, category_ids: c.categoryIds || [],
  stage_id: (c.stageIds || []).filter(Boolean).join(',') || null,
  last_active_at: c.lastActiveAt || 0,
})
const appCounter = r => ({
  id: r.id, name: r.name, operatorName: r.operator_name,
  currentTicket: r.current_ticket, status: r.status, categoryIds: r.category_ids || [],
  stageIds: (r.stage_id || '').split(',').map(s => s.trim()).filter(Boolean),
  lastActiveAt: r.last_active_at,
})

const dbCategory = c => ({
  id: c.id, name: c.name, name_ar: c.nameAr || '', name_ur: c.nameUr || '',
  name_fr: c.nameFr || '', color: c.color, prefix: c.prefix || '', stages: c.stages || [],
})
const appCategory = r => ({
  id: r.id, name: r.name, nameAr: r.name_ar, nameUr: r.name_ur,
  nameFr: r.name_fr, color: r.color, prefix: r.prefix, stages: r.stages || [],
})

// forcedCounterId is intentionally not written here — the column may not
// exist in older Supabase deployments. transferToRoom still works in-memory;
// the lock just doesn't survive a server restart, which is acceptable for
// the rare emergency-transfer case.
const dbTicket = t => ({
  number: t.number, display_number: t.displayNumber, category_id: t.categoryId,
  current_stage: t.currentStage || 0, stage_history: t.stageHistory || [],
  status: t.status, counter_id: t.counterId, created_at: t.createdAt,
  called_at: t.calledAt, completed_at: t.completedAt, notes: t.notes || '',
  transfer_history: t.transferHistory || [], held_at: t.heldAt, held_by_counter_id: t.heldByCounterId,
})
const appTicket = r => ({
  number: r.number, displayNumber: r.display_number, categoryId: r.category_id,
  currentStage: r.current_stage, stageHistory: r.stage_history || [],
  status: r.status, counterId: r.counter_id, createdAt: r.created_at,
  calledAt: r.called_at, completedAt: r.completed_at, notes: r.notes,
  transferHistory: r.transfer_history || [], heldAt: r.held_at, heldByCounterId: r.held_by_counter_id,
  forcedCounterId: r.forced_counter_id || null,
})

const dbAudit = a => ({ action: a.action, actor: a.actor || '', details: a.details || '', ts: a.timestamp })
const appAudit = r => ({ action: r.action, actor: r.actor, details: r.details, timestamp: r.ts })

const dbShift = s => ({ operator_name: s.operatorName, counter_id: s.counterId, clock_in: s.clockIn, clock_out: s.clockOut })
const appShift = r => ({ operatorName: r.operator_name, counterId: r.counter_id, clockIn: r.clock_in, clockOut: r.clock_out })

const dbBranch = b => ({ id: b.id, name: b.name, name_ar: b.nameAr || '' })
const appBranch = r => ({ id: r.id, name: r.name, nameAr: r.name_ar })

const dbWebhook = w => ({ id: w.id, url: w.url, events: w.events || ['*'] })
const appWebhook = r => ({ id: r.id, url: r.url, events: r.events || ['*'] })

export async function loadStore() {
  if (supabase) {
    try {
      const [appS, cats, ctrs, tks, audit, shifts, ann, brs, whs] = await Promise.all([
        supabase.from('app_state').select('*').eq('id', 1).single(),
        supabase.from('categories').select('*').order('position'),
        supabase.from('counters').select('*').order('id'),
        supabase.from('tickets').select('*').order('number'),
        supabase.from('audit_log').select('*').order('ts', { ascending: false }).limit(500),
        supabase.from('shifts').select('*').order('id', { ascending: false }).limit(200),
        supabase.from('announcements').select('*').order('position'),
        supabase.from('branches').select('*'),
        supabase.from('webhooks').select('*'),
      ])

      const def = makeDefault()
      const state = {
        ...def,
        license: appS.data?.license || def.license,
        nextTicketNumber: appS.data?.next_ticket_number || 1,
        activeBranch: appS.data?.active_branch || 'main',
        roles: appS.data?.roles || def.roles,
        settings: { ...def.settings, ...(appS.data?.settings || {}) },
        categories: cats.data?.length ? cats.data.map(appCategory) : def.categories,
        counters: ctrs.data?.length ? ctrs.data.map(appCounter) : def.counters,
        tickets: tks.data?.map(appTicket) || [],
        auditLog: audit.data?.map(appAudit) || [],
        shifts: shifts.data?.map(appShift) || [],
        announcements: ann.data?.map(a => a.text) || [],
        branches: brs.data?.length ? brs.data.map(appBranch) : def.branches,
        webhooks: whs.data?.map(appWebhook) || [],
      }

      // Seed defaults to DB on first run
      if (!cats.data?.length) await supabase.from('categories').upsert(state.categories.map(dbCategory))
      if (!ctrs.data?.length) await supabase.from('counters').upsert(state.counters.map(dbCounter))
      if (!brs.data?.length) await supabase.from('branches').upsert(state.branches.map(dbBranch))

      // Reconcile any counter.currentTicket that no longer points at a
      // serving ticket assigned to that counter. Earlier code paths could
      // leave this inconsistent (e.g. transferTicket only freed the source
      // counter when ticket.counterId still matched), causing the same
      // ticket to appear as both "now serving" and "waiting" on Display.
      let fixed = 0
      for (const c of state.counters) {
        if (!c.currentTicket) continue
        const t = state.tickets.find(tk => tk.number === c.currentTicket)
        if (!t || t.status !== 'serving' || t.counterId !== c.id) {
          c.currentTicket = null
          fixed++
        }
      }
      if (fixed > 0) console.log(`✓ Reconciled ${fixed} stale counter.currentTicket reference(s)`)

      console.log(`✓ Loaded from Supabase: ${state.counters.length} counters, ${state.categories.length} categories, ${state.tickets.length} tickets, ${state.auditLog.length} audit entries`)
      return state
    } catch (e) {
      console.error('Supabase load failed:', e.message)
    }
  }

  // Fallback to JSON file
  try {
    if (existsSync(DATA_FILE)) {
      const raw = readFileSync(DATA_FILE, 'utf-8')
      return { ...makeDefault(), ...JSON.parse(raw) }
    }
  } catch {}
  return makeDefault()
}

let lastSave = 0
let savePending = false
let lastAuditCount = 0
let lastShiftCount = 0

export async function saveStore(state, { force = false } = {}) {
  const now = Date.now()
  if (!force && now - lastSave < 2000) {
    if (!savePending) {
      savePending = true
      setTimeout(() => { savePending = false; saveStore(state) }, 2000 - (now - lastSave))
    }
    return
  }
  lastSave = now

  if (supabase) {
    try {
      // 1. App state (settings, license, nextTicketNumber, etc.)
      const appStatePromise = supabase.from('app_state').upsert({
        id: 1,
        next_ticket_number: state.nextTicketNumber,
        active_branch: state.activeBranch,
        license: state.license,
        roles: state.roles,
        settings: state.settings,
        updated_at: new Date().toISOString(),
      })

      // 2. Counters (sync exactly — delete removed, upsert current)
      const counterIds = state.counters.map(c => c.id)
      const countersPromise = (async () => {
        if (counterIds.length > 0) {
          await supabase.from('counters').delete().not('id', 'in', `(${counterIds.join(',')})`)
          await supabase.from('counters').upsert(state.counters.map(dbCounter))
        }
      })()

      // 3. Categories (sync exactly — delete removed, upsert current)
      const categoryIds = state.categories.map(c => c.id)
      const categoriesPromise = (async () => {
        if (categoryIds.length > 0) {
          const idList = categoryIds.map(id => `"${id.replace(/"/g, '""')}"`).join(',')
          await supabase.from('categories').delete().not('id', 'in', `(${idList})`)
          await supabase.from('categories').upsert(state.categories.map((c, i) => ({ ...dbCategory(c), position: i })))
        }
      })()

      // 4. Tickets (upsert all — could optimize to only dirty ones later)
      const ticketsPromise = state.tickets.length
        ? supabase.from('tickets').upsert(state.tickets.map(dbTicket))
        : Promise.resolve()

      // 5. Audit log — append-only, only new entries
      const auditDelta = state.auditLog.length - lastAuditCount
      const auditPromise = auditDelta > 0
        ? supabase.from('audit_log').insert(state.auditLog.slice(0, auditDelta).map(dbAudit))
            .then(() => { lastAuditCount = state.auditLog.length })
        : Promise.resolve()

      // 6. Shifts — sync recent ones
      const shiftsPromise = state.shifts.length
        ? supabase.from('shifts').upsert(state.shifts.map(dbShift), { onConflict: 'operator_name,clock_in', ignoreDuplicates: false }).catch(() => {})
        : Promise.resolve()

      // 7. Announcements — replace all (small list)
      const annPromise = (async () => {
        await supabase.from('announcements').delete().neq('id', 0)
        if (state.announcements.length) {
          await supabase.from('announcements').insert(state.announcements.map((text, i) => ({ text, position: i })))
        }
      })()

      // 8. Branches
      const branchesPromise = state.branches.length
        ? supabase.from('branches').upsert(state.branches.map(dbBranch))
        : Promise.resolve()

      // 9. Webhooks
      const webhooksPromise = (async () => {
        await supabase.from('webhooks').delete().neq('id', '')
        if (state.webhooks?.length) {
          await supabase.from('webhooks').insert(state.webhooks.map(dbWebhook))
        }
      })()

      await Promise.all([
        appStatePromise, countersPromise, categoriesPromise, ticketsPromise,
        auditPromise, shiftsPromise, annPromise, branchesPromise, webhooksPromise,
      ])
    } catch (e) {
      console.error('Supabase save failed:', e.message)
    }
  }

  // Backup to JSON file
  try { writeFileSync(DATA_FILE, JSON.stringify(state, null, 2)) } catch {}
}

// ---- Ticket operations ----

export function takeTicket(state, categoryId) {
  const number = state.nextTicketNumber++
  const cat = state.categories.find(c => c.id === categoryId)
  const prefix = cat?.prefix || ''
  const ticket = {
    number,
    displayNumber: prefix ? `${prefix}-${String(number).padStart(3, '0')}` : String(number).padStart(3, '0'),
    categoryId,
    currentStage: 0,
    stageHistory: [],
    status: 'waiting',
    counterId: null,
    createdAt: Date.now(),
    calledAt: null,
    completedAt: null,
    notes: '',
    transferHistory: [],
  }
  state.tickets.push(ticket)
  return ticket
}

// When the operator clicks Call Next, decide what to do with the patient
// they were just serving:
//   - If the patient was at one of THIS counter's normal stages, treat
//     Call Next as "done at this stage, move them along the linear workflow
//     to the next stage." This is the Reception → OPD → ... flow.
//   - If the patient was manually picked from a stage outside this counter's
//     scope (e.g. OPD pulling an eye-drops patient out of the waiting
//     sidebar), don't silently shove them down a workflow they didn't ask
//     for — mark them served. The operator is in charge of using Send To
//     if they want a specific destination.
function autoMoveCurrent(state, counter) {
  if (!counter.currentTicket) return
  const prev = state.tickets.find(t => t.number === counter.currentTicket)
  if (!prev || prev.status !== 'serving') return
  const cat = state.categories.find(c => c.id === prev.categoryId)
  const stages = cat?.stages || []
  const currentIdx = prev.currentStage || 0
  const currentStageId = stages[currentIdx]?.id

  if (stages[currentIdx]) {
    prev.stageHistory = prev.stageHistory || []
    prev.stageHistory.push({
      stage: currentIdx,
      stageName: stages[currentIdx].name,
      counterId: counter.id,
      completedAt: Date.now(),
    })
  }

  const handlesStage =
    !counter.stageIds || counter.stageIds.length === 0 ||
    (currentStageId && counter.stageIds.includes(currentStageId))

  if (handlesStage && currentIdx + 1 < stages.length) {
    prev.currentStage = currentIdx + 1
    prev.status = 'waiting'
    prev.counterId = null
    prev.calledAt = null
  } else {
    prev.status = 'served'
    prev.completedAt = Date.now()
  }
}

export function callNext(state, counterId, specificTicketNumber = null) {
  const counter = state.counters.find(c => c.id === counterId)
  if (!counter || counter.status === 'closed') return null

  // Either advance the previous patient to the next workflow stage (if this
  // counter handles that stage) or mark them served (if they were a manual
  // out-of-scope pick).
  autoMoveCurrent(state, counter)

  // If the operator picked a specific ticket from the waiting list (e.g. an
  // eye-drops patient OPD wants to call now), grab that one and bypass the
  // stage/category filter — the operator made an explicit choice.
  let next
  if (specificTicketNumber != null) {
    next = state.tickets.find(t => t.number === specificTicketNumber && t.status === 'waiting')
    if (!next) {
      counter.currentTicket = null
      return null
    }
  } else {
    // Find next waiting ticket — prioritize tickets forced to this counter,
    // then filter by category/stage assignment.
    const validCategories = counter.categoryIds.length > 0 ? counter.categoryIds : state.categories.map(c => c.id)
    const waiting = state.tickets
      .filter(t => {
        if (t.status !== 'waiting') return false
        // Forced-to-this-counter takes priority and bypasses category/stage filters
        if (t.forcedCounterId) return t.forcedCounterId === counterId
        if (!validCategories.includes(t.categoryId)) return false
        // Stage filtering: if counter has stageIds, only serve tickets whose
        // current stage is one of those.
        if (counter.stageIds && counter.stageIds.length > 0) {
          const cat = state.categories.find(c => c.id === t.categoryId)
          const ticketStage = cat?.stages?.[t.currentStage || 0]
          if (!ticketStage || !counter.stageIds.includes(ticketStage.id)) return false
        }
        return true
      })
      .sort((a, b) => {
        // Forced transfers first, then by ticket number
        if (a.forcedCounterId && !b.forcedCounterId) return -1
        if (b.forcedCounterId && !a.forcedCounterId) return 1
        return a.number - b.number
      })

    next = waiting[0]
  }
  if (!next) {
    counter.currentTicket = null
    return null
  }

  next.status = 'serving'
  next.counterId = counterId
  next.forcedCounterId = null
  counter.lastActiveAt = Date.now()
  next.calledAt = Date.now()
  counter.currentTicket = next.number
  return next
}

export function recallTicket(state, counterId) {
  const counter = state.counters.find(c => c.id === counterId)
  if (!counter || !counter.currentTicket) return null
  const ticket = state.tickets.find(t => t.number === counter.currentTicket)
  return ticket || null
}

export function skipTicket(state, counterId) {
  const counter = state.counters.find(c => c.id === counterId)
  if (!counter || !counter.currentTicket) return null

  const ticket = state.tickets.find(t => t.number === counter.currentTicket)
  if (ticket) {
    ticket.status = 'skipped'
    ticket.completedAt = Date.now()
  }
  counter.currentTicket = null
  return ticket
}

export function completeTicket(state, counterId) {
  const counter = state.counters.find(c => c.id === counterId)
  if (!counter || !counter.currentTicket) return null

  const ticket = state.tickets.find(t => t.number === counter.currentTicket)
  if (ticket) {
    ticket.status = 'served'
    ticket.completedAt = Date.now()
  }
  counter.currentTicket = null
  return ticket
}

export function transferTicket(state, ticketNumber, toCategoryId, toCounterId = null) {
  const ticket = state.tickets.find(t => t.number === ticketNumber)
  if (!ticket) return null

  ticket.transferHistory = ticket.transferHistory || []
  ticket.transferHistory.push({
    fromCategoryId: ticket.categoryId,
    fromCounterId: ticket.counterId,
    at: Date.now(),
  })

  // Free any counter still holding this ticket — not just ticket.counterId.
  // Iterating defends against the rare case where a previous code path
  // cleared the ticket's counterId without clearing the counter's
  // currentTicket, which left the ticket showing in both "now serving"
  // and "waiting" on the Display.
  for (const c of state.counters) {
    if (c.currentTicket === ticketNumber) c.currentTicket = null
  }

  if (toCategoryId) ticket.categoryId = toCategoryId
  ticket.status = 'waiting'
  ticket.counterId = null

  if (toCounterId) {
    const dest = state.counters.find(c => c.id === toCounterId)
    if (dest) {
      ticket.status = 'serving'
      ticket.counterId = toCounterId
      ticket.calledAt = Date.now()
      dest.currentTicket = ticketNumber
    }
  }

  return ticket
}

// Transfer a patient to a specific room/counter (same stage, different counter)
// Sets forcedCounterId so only that counter can pick them up.
export function transferToRoom(state, ticketNumber, toCounterId, fromCounterId) {
  const ticket = state.tickets.find(t => t.number === ticketNumber)
  if (!ticket) return null

  const dest = state.counters.find(c => c.id === toCounterId)
  if (!dest) return null

  ticket.transferHistory = ticket.transferHistory || []
  ticket.transferHistory.push({
    fromCounterId: ticket.counterId,
    toCounterId,
    at: Date.now(),
    type: 'room',
  })

  // Free any counter still holding this ticket (see transferTicket).
  for (const c of state.counters) {
    if (c.currentTicket === ticketNumber) c.currentTicket = null
  }

  // Align ticket stage with destination counter's stage (if it has any).
  // When the counter handles multiple stages, prefer the ticket's current
  // stage if it's already covered; otherwise jump to the first stage the
  // destination counter handles.
  if (dest.stageIds && dest.stageIds.length > 0) {
    const cat = state.categories.find(c => c.id === ticket.categoryId)
    const stages = cat?.stages || []
    const currentStageObj = stages[ticket.currentStage || 0]
    if (!currentStageObj || !dest.stageIds.includes(currentStageObj.id)) {
      const stageIdx = stages.findIndex(s => dest.stageIds.includes(s.id))
      if (stageIdx !== -1) ticket.currentStage = stageIdx
    }
  }

  // Send to waiting; lock to the destination counter
  ticket.status = 'waiting'
  ticket.counterId = null
  ticket.calledAt = null
  ticket.forcedCounterId = toCounterId

  return ticket
}

export function holdTicket(state, counterId) {
  const counter = state.counters.find(c => c.id === counterId)
  if (!counter || !counter.currentTicket) return null

  const ticket = state.tickets.find(t => t.number === counter.currentTicket)
  if (ticket) {
    ticket.status = 'held'
    ticket.heldAt = Date.now()
    ticket.heldByCounterId = counterId
  }
  counter.currentTicket = null
  return ticket
}

export function unholdTicket(state, ticketNumber, counterId) {
  const ticket = state.tickets.find(t => t.number === ticketNumber && t.status === 'held')
  if (!ticket) return null

  const counter = state.counters.find(c => c.id === counterId)
  if (!counter) return null

  // Complete current ticket at counter if any
  if (counter.currentTicket) {
    const prev = state.tickets.find(t => t.number === counter.currentTicket)
    if (prev && prev.status === 'serving') {
      prev.status = 'served'
      prev.completedAt = Date.now()
    }
  }

  ticket.status = 'serving'
  ticket.counterId = counterId
  ticket.calledAt = Date.now()
  ticket.heldAt = null
  counter.currentTicket = ticket.number
  counter.lastActiveAt = Date.now()
  return ticket
}

export function addNote(state, ticketNumber, note) {
  const ticket = state.tickets.find(t => t.number === ticketNumber)
  if (ticket) ticket.notes = note
  return ticket
}

export async function resetQueue(state) {
  state.tickets = []
  state.nextTicketNumber = 1
  state.counters.forEach(c => { c.currentTicket = null })
  // Also wipe tickets table in Supabase (otherwise old rows linger)
  if (supabase) {
    try {
      await supabase.from('tickets').delete().neq('number', 0)
    } catch (e) {
      console.error('Failed to clear tickets in Supabase:', e.message)
    }
  }
}

export function getAnalytics(state) {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const todayMs = today.getTime()

  const todayTickets = state.tickets.filter(t => t.createdAt >= todayMs)
  const served = todayTickets.filter(t => t.status === 'served')

  // avg service time
  const serviceTimes = served
    .filter(t => t.calledAt && t.completedAt)
    .map(t => (t.completedAt - t.calledAt) / 1000)
  const avgServiceTime = serviceTimes.length > 0
    ? Math.round(serviceTimes.reduce((a, b) => a + b, 0) / serviceTimes.length)
    : 0

  // avg wait time
  const waitTimes = served
    .filter(t => t.calledAt)
    .map(t => (t.calledAt - t.createdAt) / 1000)
  const avgWaitTime = waitTimes.length > 0
    ? Math.round(waitTimes.reduce((a, b) => a + b, 0) / waitTimes.length)
    : 0

  // peak hours (0-23)
  const hourCounts = Array(24).fill(0)
  todayTickets.forEach(t => {
    const h = new Date(t.createdAt).getHours()
    hourCounts[h]++
  })

  // category breakdown
  const categoryBreakdown = {}
  todayTickets.forEach(t => {
    categoryBreakdown[t.categoryId] = (categoryBreakdown[t.categoryId] || 0) + 1
  })

  return {
    totalIssued: todayTickets.length,
    totalServed: served.length,
    totalWaiting: todayTickets.filter(t => t.status === 'waiting').length,
    totalSkipped: todayTickets.filter(t => t.status === 'skipped').length,
    avgServiceTime,
    avgWaitTime,
    hourCounts,
    categoryBreakdown,
  }
}

export function getTicketPosition(state, ticketNumber) {
  const ticket = state.tickets.find(t => t.number === ticketNumber)
  if (!ticket) return null

  if (ticket.status !== 'waiting') {
    return { ticket, position: 0, estimatedWait: 0 }
  }

  const ahead = state.tickets.filter(
    t => t.status === 'waiting' &&
      t.categoryId === ticket.categoryId &&
      t.number < ticket.number
  ).length

  return { ticket, position: ahead + 1, estimatedWait: (ahead + 1) * 2 }
}

export function getAdvancedAnalytics(state) {
  const now = Date.now()
  const allServed = state.tickets.filter(t => t.status === 'served' && t.calledAt && t.completedAt)

  // Weekly trends (last 7 days)
  const weeklyTrends = []
  for (let d = 6; d >= 0; d--) {
    const dayStart = new Date(now)
    dayStart.setDate(dayStart.getDate() - d)
    dayStart.setHours(0, 0, 0, 0)
    const dayEnd = new Date(dayStart)
    dayEnd.setDate(dayEnd.getDate() + 1)
    const dayTickets = state.tickets.filter(t => t.createdAt >= dayStart.getTime() && t.createdAt < dayEnd.getTime())
    const dayServed = dayTickets.filter(t => t.status === 'served')
    weeklyTrends.push({
      date: dayStart.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }),
      dayName: dayStart.toLocaleDateString('en-US', { weekday: 'short' }),
      issued: dayTickets.length,
      served: dayServed.length,
    })
  }

  // Busiest day of week (all-time)
  const dayOfWeekCounts = Array(7).fill(0)
  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  state.tickets.forEach(t => {
    dayOfWeekCounts[new Date(t.createdAt).getDay()]++
  })

  // Operator performance
  const operatorStats = {}
  state.counters.forEach(c => {
    if (!c.operatorName) return
    const opTickets = allServed.filter(t => t.counterId === c.id)
    const serviceTimes = opTickets.map(t => (t.completedAt - t.calledAt) / 1000)
    operatorStats[c.operatorName] = {
      counterId: c.id,
      counterName: c.name,
      totalServed: opTickets.length,
      avgServiceTime: serviceTimes.length > 0 ? Math.round(serviceTimes.reduce((a, b) => a + b, 0) / serviceTimes.length) : 0,
    }
  })

  // Service time by category
  const categoryServiceTimes = {}
  state.categories.forEach(cat => {
    const catServed = allServed.filter(t => t.categoryId === cat.id)
    const times = catServed.map(t => (t.completedAt - t.calledAt) / 1000)
    categoryServiceTimes[cat.id] = {
      name: cat.name,
      color: cat.color,
      totalServed: catServed.length,
      avgServiceTime: times.length > 0 ? Math.round(times.reduce((a, b) => a + b, 0) / times.length) : 0,
    }
  })

  return { weeklyTrends, dayOfWeekCounts, dayNames, operatorStats, categoryServiceTimes }
}

// Smart routing — find the best counter for a ticket
export function findBestCounter(state, categoryId, stageId = null) {
  const eligible = state.counters.filter(c => {
    if (c.status === 'closed' || !c.operatorName) return false
    if (c.categoryIds.length > 0 && !c.categoryIds.includes(categoryId)) return false
    // If we're routing for a specific stage, counter must serve that stage
    // (counters with no stage restriction match any).
    if (stageId && c.stageIds && c.stageIds.length > 0 && !c.stageIds.includes(stageId)) return false
    return true
  })
  if (eligible.length === 0) return null

  return eligible.sort((a, b) => {
    const aLoad = state.tickets.filter(t => t.counterId === a.id && t.status === 'serving').length
    const bLoad = state.tickets.filter(t => t.counterId === b.id && t.status === 'serving').length
    return aLoad - bLoad
  })[0]
}

// Advance ticket to next stage (medical workflow)
// Advance ticket to a specific stage (by index) or the next stage if not provided.
// Pass targetStageId to jump to a specific stage by its id (non-linear routing).
export function advanceTicket(state, counterId, targetStageId = null) {
  const counter = state.counters.find(c => c.id === counterId)
  if (!counter || !counter.currentTicket) return null

  const ticket = state.tickets.find(t => t.number === counter.currentTicket)
  if (!ticket) return null

  const cat = state.categories.find(c => c.id === ticket.categoryId)
  const stages = cat?.stages || []
  const currentStageIdx = ticket.currentStage || 0

  // Record stage completion in history
  if (stages[currentStageIdx]) {
    ticket.stageHistory = ticket.stageHistory || []
    ticket.stageHistory.push({
      stage: currentStageIdx,
      stageName: stages[currentStageIdx].name,
      counterId,
      completedAt: Date.now(),
    })
  }

  // Determine target stage
  let targetIdx
  if (targetStageId) {
    targetIdx = stages.findIndex(s => s.id === targetStageId)
    if (targetIdx === -1) targetIdx = currentStageIdx + 1
  } else {
    targetIdx = currentStageIdx + 1
  }

  // If target is valid, route there
  if (targetIdx >= 0 && targetIdx < stages.length) {
    ticket.currentStage = targetIdx
    ticket.status = 'waiting'
    ticket.counterId = null
    ticket.calledAt = null
    counter.currentTicket = null
    counter.lastActiveAt = Date.now()
    return { ticket, nextStage: stages[targetIdx], finished: false }
  }

  // Otherwise — complete the ticket
  ticket.status = 'served'
  ticket.completedAt = Date.now()
  counter.currentTicket = null
  counter.lastActiveAt = Date.now()
  return { ticket, nextStage: null, finished: true }
}

// Check and close idle counters
export function checkIdleCounters(state, timeoutMs) {
  if (!timeoutMs || timeoutMs <= 0) return []
  const now = Date.now()
  const closed = []
  state.counters.forEach(c => {
    if (c.status === 'open' && c.operatorName && !c.currentTicket) {
      const lastActive = c.lastActiveAt || 0
      if (lastActive > 0 && (now - lastActive) > timeoutMs) {
        c.status = 'closed'
        closed.push(c)
      }
    }
  })
  return closed
}

// Get estimated wait per category
export function getCategoryWaitTimes(state) {
  const result = {}
  for (const cat of state.categories) {
    const waiting = state.tickets.filter(t => t.status === 'waiting' && t.categoryId === cat.id).length
    const served = state.tickets.filter(t => t.status === 'served' && t.categoryId === cat.id && t.calledAt && t.completedAt)
    const avgService = served.length > 0
      ? served.reduce((sum, t) => sum + (t.completedAt - t.calledAt), 0) / served.length / 1000
      : 120
    result[cat.id] = { waiting, avgServiceSec: Math.round(avgService), estWaitMin: Math.max(1, Math.round((waiting * avgService) / 60)) }
  }
  return result
}

// ---- Audit Log ----
export function addAudit(state, action, actor, details = '') {
  const entry = { action, actor, details, timestamp: Date.now() }
  state.auditLog.unshift(entry)
  if (state.auditLog.length > 500) state.auditLog.length = 500
  return entry
}

// ---- Shifts ----
export function clockIn(state, operatorName, counterId) {
  const shift = { operatorName, counterId, clockIn: Date.now(), clockOut: null }
  state.shifts.push(shift)
  return shift
}

export function clockOut(state, operatorName) {
  const shift = [...state.shifts].reverse().find(s => s.operatorName === operatorName && !s.clockOut)
  if (shift) shift.clockOut = Date.now()
  return shift
}

// ---- Monthly Analytics ----
export function getMonthlyAnalytics(state) {
  const now = Date.now()
  const monthlyTrends = []
  for (let d = 29; d >= 0; d--) {
    const dayStart = new Date(now)
    dayStart.setDate(dayStart.getDate() - d)
    dayStart.setHours(0, 0, 0, 0)
    const dayEnd = new Date(dayStart)
    dayEnd.setDate(dayEnd.getDate() + 1)
    const dayTickets = state.tickets.filter(t => t.createdAt >= dayStart.getTime() && t.createdAt < dayEnd.getTime())
    monthlyTrends.push({
      date: dayStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      served: dayTickets.filter(t => t.status === 'served').length,
      issued: dayTickets.length,
    })
  }

  // Wait time histogram (buckets: 0-1m, 1-2m, 2-5m, 5-10m, 10-15m, 15m+)
  const buckets = [0, 0, 0, 0, 0, 0]
  const bucketLabels = ['<1m', '1-2m', '2-5m', '5-10m', '10-15m', '15m+']
  state.tickets.filter(t => t.status === 'served' && t.calledAt).forEach(t => {
    const waitMin = (t.calledAt - t.createdAt) / 60000
    if (waitMin < 1) buckets[0]++
    else if (waitMin < 2) buckets[1]++
    else if (waitMin < 5) buckets[2]++
    else if (waitMin < 10) buckets[3]++
    else if (waitMin < 15) buckets[4]++
    else buckets[5]++
  })

  return { monthlyTrends, waitHistogram: { buckets, labels: bucketLabels } }
}
