// ============================================================================
// CLINIC SETUP — Edit this file to configure your counters and rooms
// ============================================================================
// This file is loaded ONCE when the server starts with no existing data in
// Supabase. To re-apply changes, delete the categories/counters rows in
// Supabase and restart the server. Existing data will be preserved otherwise.
// ============================================================================

// Each counter handles one or more workflow stages. OPD also handles the
// eye-drops stage because eye drops are administered at OPD in this clinic.
export const CLINIC_COUNTERS = [
  // ---- Reception ----
  { id: 1, name: 'Reception 1', operatorName: '', currentTicket: null, status: 'open', categoryIds: [], stageIds: ['reception'], lastActiveAt: 0 },
  { id: 2, name: 'Reception 2', operatorName: '', currentTicket: null, status: 'open', categoryIds: [], stageIds: ['reception'], lastActiveAt: 0 },
  { id: 3, name: 'Reception 3', operatorName: '', currentTicket: null, status: 'open', categoryIds: [], stageIds: ['reception'], lastActiveAt: 0 },

  // ---- OPD (Outpatient Department) ----
  // OPD only handles 'opd' stage on Call Next. Eye-drops patients wait
  // until an operator manually clicks them in the waiting sidebar.
  { id: 4, name: 'OPD A', operatorName: '', currentTicket: null, status: 'open', categoryIds: [], stageIds: ['opd'], lastActiveAt: 0 },

  // ---- Optometrist Rooms ----
  { id: 5, name: 'Optometrist B1', operatorName: '', currentTicket: null, status: 'open', categoryIds: [], stageIds: ['optometrist'], lastActiveAt: 0 },
  { id: 6, name: 'Optometrist B2', operatorName: '', currentTicket: null, status: 'open', categoryIds: [], stageIds: ['optometrist'], lastActiveAt: 0 },

  // ---- Doctor Rooms ----
  { id: 7, name: 'Doctor D1', operatorName: '', currentTicket: null, status: 'open', categoryIds: [], stageIds: ['doctor'], lastActiveAt: 0 },
  { id: 8, name: 'Doctor D2', operatorName: '', currentTicket: null, status: 'open', categoryIds: [], stageIds: ['doctor'], lastActiveAt: 0 },
  { id: 9, name: 'Doctor D3', operatorName: '', currentTicket: null, status: 'open', categoryIds: [], stageIds: ['doctor'], lastActiveAt: 0 },
  { id: 10, name: 'Doctor D4', operatorName: '', currentTicket: null, status: 'open', categoryIds: [], stageIds: ['doctor'], lastActiveAt: 0 },
]

// Common stages used across all visit types — operator picks the path at each step
const ALL_STAGES = [
  { id: 'reception', name: 'Reception' },
  { id: 'opd', name: 'OPD' },
  { id: 'eye-drops', name: 'Eye Drops' },
  { id: 'optometrist', name: 'Optometrist' },
  { id: 'doctor', name: 'Doctor' },
  { id: 'pre-op', name: 'Pre-Op' },
  { id: 'surgery', name: 'Surgery' },
  { id: 'pharmacy', name: 'Pharmacy' },
]

export const CLINIC_CATEGORIES = [
  // New visit — full intake flow
  {
    id: 'new-visit',
    name: 'New Visit',
    nameAr: 'زيارة جديدة',
    nameUr: 'نیا دورہ',
    nameFr: 'Nouvelle visite',
    color: '#4f8ff7',
    prefix: 'N',
    stages: ALL_STAGES,
  },

  // Follow-up visit — returning patients, simpler flow
  {
    id: 'follow-up',
    name: 'Follow-up Visit',
    nameAr: 'زيارة متابعة',
    nameUr: 'فالو اپ ملاقات',
    nameFr: 'Suivi',
    color: '#34d399',
    prefix: 'F',
    stages: ALL_STAGES,
  },

  // Surgery visit — patients scheduled for surgery
  {
    id: 'surgery',
    name: 'Surgery Visit',
    nameAr: 'زيارة جراحة',
    nameUr: 'سرجری دورہ',
    nameFr: 'Visite chirurgie',
    color: '#ec4899',
    prefix: 'S',
    stages: ALL_STAGES,
  },
]
