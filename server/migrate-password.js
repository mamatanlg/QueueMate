import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'

const s = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } })

const { data, error } = await s.from('app_state').select('roles').eq('id', 1).single()
if (error) { console.error(error.message); process.exit(1) }

const roles = { ...(data.roles || {}), adminPassword: '2811' }
await s.from('app_state').update({ roles }).eq('id', 1)
console.log('✓ Admin password set to 2811')
