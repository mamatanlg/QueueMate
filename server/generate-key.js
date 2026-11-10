import { generateLicenseKey } from './store.js'

const seed = process.argv[2] || `key-${Date.now()}`
const key = generateLicenseKey(seed)
console.log(`\nLicense Key: ${key}\n`)
console.log(`Seed: ${seed}`)
console.log(`\nTo generate more keys: node server/generate-key.js <seed>\n`)
