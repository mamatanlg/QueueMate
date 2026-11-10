// One-time migration: replace the existing categories with the new visit types.
// Run with: node server/migrate-categories.js

import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'
import { CLINIC_CATEGORIES } from './clinic-setup.js'

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } })

console.log('Replacing categories with new visit types...')

// Delete all existing categories
const { error: delErr } = await supabase.from('categories').delete().neq('id', '___never___')
if (delErr) { console.error('Delete failed:', delErr.message); process.exit(1) }

// Insert new categories
const rows = CLINIC_CATEGORIES.map((c, i) => ({
  id: c.id,
  name: c.name,
  name_ar: c.nameAr || '',
  name_ur: c.nameUr || '',
  name_fr: c.nameFr || '',
  color: c.color,
  prefix: c.prefix,
  stages: c.stages,
  position: i,
}))

const { error: insErr } = await supabase.from('categories').insert(rows)
if (insErr) { console.error('Insert failed:', insErr.message); process.exit(1) }

console.log(`✓ Migrated to ${rows.length} categories:`)
rows.forEach(r => console.log(`  ${r.prefix}- ${r.name} (${r.stages.length} stages)`))
console.log('\nRestart the server to pick up the changes.')
