import { execSync } from 'child_process'
import { readFileSync, existsSync } from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const pkg = JSON.parse(readFileSync(path.join(__dirname, '../package.json'), 'utf-8')) as { version: string; name: string }

const zipPath = path.join(__dirname, `../release/crx-${pkg.name}-${pkg.version}.zip`)

console.log(`\nReleasing ${pkg.name} v${pkg.version}...\n`)

// Build first
execSync('node --loader ts-node/esm scripts/build.ts', { stdio: 'inherit' })

if (!existsSync(zipPath)) {
  console.error('✗ Release zip not found at:', zipPath)
  process.exit(1)
}

console.log(`\n✓ Release artifact ready:`)
console.log(`  ${zipPath}\n`)
console.log('Next steps:')
console.log('  1. Test the .zip by loading it in chrome://extensions')
console.log('  2. Upload to Chrome Web Store developer dashboard')
console.log('  3. Tag the git commit: git tag v' + pkg.version)
