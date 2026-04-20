import { setupRouter } from './router'
import { createLogger } from '@/shared/utils/logger'

const logger = createLogger('sw')

logger.info('CodePilot service worker starting')
setupRouter()
logger.info('CodePilot service worker ready')

// Keep service worker alive during active ports (Chrome MV3 limitation)
chrome.runtime.onConnect.addListener((_port) => {
  // Ports keep the service worker alive automatically
})
