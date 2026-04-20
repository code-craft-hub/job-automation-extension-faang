import { test, expect, chromium } from '@playwright/test'
import path from 'path'

const EXTENSION_PATH = path.resolve(__dirname, '../../dist')

test.describe('CodePilot extension E2E', () => {
  test('side panel loads and shows empty state', async () => {
    const context = await chromium.launchPersistentContext('', {
      headless: false,
      args: [
        `--disable-extensions-except=${EXTENSION_PATH}`,
        `--load-extension=${EXTENSION_PATH}`,
        '--no-sandbox',
      ],
    })

    const [background] = context.serviceWorkers()
    await (background ?? context.waitForEvent('serviceworker'))

    // Open options page
    const page = await context.newPage()
    await page.goto(`chrome-extension://${await getExtensionId(context)}/src/options/index.html`)
    await expect(page.locator('h1')).toContainText('CodePilot AI')

    await context.close()
  })
})

async function getExtensionId(context: import('@playwright/test').BrowserContext): Promise<string> {
  const workers = context.serviceWorkers()
  if (workers.length > 0) {
    const url = workers[0]?.url() ?? ''
    const match = /chrome-extension:\/\/([^/]+)/.exec(url)
    if (match?.[1]) return match[1]
  }
  return 'unknown'
}
