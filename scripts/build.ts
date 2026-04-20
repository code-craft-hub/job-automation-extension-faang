import { execSync } from 'child_process'
import { readFileSync } from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const pkg = JSON.parse(readFileSync(path.join(__dirname, '../package.json'), 'utf-8')) as { version: string; name: string }

console.log(`\nBuilding ${pkg.name} v${pkg.version}...\n`)

const start = Date.now()

try {
  execSync('tsc -b', { stdio: 'inherit' })
  execSync('vite build', { stdio: 'inherit' })
  const elapsed = ((Date.now() - start) / 1000).toFixed(1)
  console.log(`\n✓ Build complete in ${elapsed}s`)
  console.log(`  Output: dist/`)
  console.log(`  Release: release/crx-${pkg.name}-${pkg.version}.zip\n`)
} catch (err) {
  console.error('\n✗ Build failed:', err)
  process.exit(1)
}
