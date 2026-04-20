import { defineManifest } from '@crxjs/vite-plugin'
import pkg from './package.json'

export default defineManifest({
  manifest_version: 3,
  name: 'CodePilot AI — Gemini Code Assistant',
  version: pkg.version,
  description: 'Enterprise AI coding assistant powered by Gemini. Claude Code for your browser.',
  permissions: [
    'storage',
    'activeTab',
    'scripting',
    'sidePanel',
    'contextMenus',
    'notifications',
  ],
  host_permissions: ['https://generativelanguage.googleapis.com/*'],
  background: {
    service_worker: 'src/background/sw-entry.ts',
    type: 'module',
  },
  action: {
    default_popup: 'src/popup/index.html',
    default_icon: {
      16: 'public/icons/icon16.png',
      48: 'public/icons/icon48.png',
      128: 'public/icons/icon128.png',
    },
  },
  side_panel: {
    default_path: 'src/sidepanel/index.html',
  },
  content_scripts: [
    {
      matches: ['<all_urls>'],
      js: ['src/content/index.ts'],
      run_at: 'document_idle',
    },
  ],
  content_security_policy: {
    extension_pages: "script-src 'self'; object-src 'self'",
  },
  options_ui: {
    page: 'src/options/index.html',
    open_in_tab: true,
  },
  icons: {
    16: 'public/icons/icon16.png',
    48: 'public/icons/icon48.png',
    128: 'public/icons/icon128.png',
  },
})
