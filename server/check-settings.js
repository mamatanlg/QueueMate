import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'

const s = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } })

const { data } = await s.from('app_state').select('*').eq('id', 1).single()
console.log('Settings in DB:')
console.log(JSON.stringify(data.settings, null, 2))
console.log('\nLast saved:', data.updated_at)
