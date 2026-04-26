import { defineManifest } from '@crxjs/vite-plugin'
import pkg from './package.json'

export default defineManifest({
  manifest_version: 3,
  name: pkg.name,
  version: pkg.version,
  icons: {
    48: 'public/logo.png',
  },
  action: {
    default_icon: {
      48: 'public/logo.png',
    },
  },
  background: {
    service_worker: 'src/background/index.ts',
    type: 'module',
  },
  permissions: [
    'sidePanel',
    'contentSettings',
    'storage',
    'scripting',
    'tabs',
  ],
  host_permissions: [
    'https://generativelanguage.googleapis.com/*',
    'https://*/*',
    'http://localhost/*',
  ],
  content_scripts: [{
    js: ['src/content/main.tsx'],
    matches: ['https://*/*', 'http://localhost/*'],
  }],
  side_panel: {
    default_path: 'src/sidepanel/index.html',
  },
  web_accessible_resources: [{
    resources: ['public/cverai.resume.pdf'],
    matches: ['https://*/*'],
  }],
})
