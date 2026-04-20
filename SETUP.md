# CodePilot AI — Setup Guide

## Prerequisites

- Node.js 18+ and pnpm (`npm i -g pnpm`)
- Chrome 114+ (MV3 + Side Panel API)
- A Google AI Studio API key — get one free at https://aistudio.google.com/app/apikey

---

## 1. Install dependencies

```bash
pnpm install
```

## 2. Build the extension

```bash
pnpm build
```

This runs TypeScript type-checking then Vite build. Output goes to `dist/`.

## 3. Load in Chrome

1. Open `chrome://extensions`
2. Enable **Developer mode** (top-right toggle)
3. Click **Load unpacked**
4. Select the `dist/` folder inside this project
5. The extension installs — you'll see the ✦ icon in your toolbar

## 4. Configure your API key

**Option A — Options page (recommended):**
1. Right-click the ✦ toolbar icon → **Options**
2. Paste your Gemini API key in the field
3. Click **Test** to verify it works
4. Click **Save Settings**

**Option B — Popup:**
1. Click the ✦ toolbar icon
2. Click **Settings**

Your API key is stored in `chrome.storage.sync` — it syncs across your Chrome profile and is never embedded in source code.

## 5. Open the side panel

**Method 1:** Click the ✦ toolbar icon → **Open Side Panel**

**Method 2:** Right-click anywhere on a page → **Open CodePilot**

**Method 3:** Click the ✦ toolbar icon directly (the side panel opens automatically)

The side panel will appear on the right side of your browser at 400px wide.

---

## Development

```bash
# Watch mode — rebuilds on save
pnpm dev

# Type-check only
npx tsc -b --noEmit

# Run unit tests
pnpm test

# Lint
pnpm lint

# Format
pnpm format
```

After `pnpm dev` makes a change, go to `chrome://extensions` and click the **↻ refresh** button on the CodePilot card.

---

## Project Structure

```
src/
├── background/     # Service worker — Gemini API, session mgmt, routing
├── content/        # Content script — DOM reading, code injection
├── sidepanel/      # Main UI — chat, sessions, settings
├── popup/          # Toolbar popup — quick launcher
├── options/        # Full settings page
└── shared/         # Types, constants, utils (shared across all contexts)
```

---

## Security Notes

- **API key** is stored only in `chrome.storage.sync` — never in source code or localStorage
- All HTML injected into the page goes through **DOMPurify**
- **CSP** on extension pages: `script-src 'self'; object-src 'self'`
- All API requests go only to `generativelanguage.googleapis.com`
- API key is redacted from all log output

---

## Troubleshooting

**Side panel doesn't open:**
- Make sure `sidePanel` permission is in the manifest
- Chrome 114+ required

**Streaming doesn't work:**
- Check the API key in Options
- Open DevTools → Service Worker → check for errors in the background console
- Ensure `host_permissions` includes `https://generativelanguage.googleapis.com/*`

**"No editor found" when applying code:**
- The Apply button works with Monaco (VS Code Web, CodePen), CodeMirror (Replit, Codemirror playgrounds), and active textareas
- For other editors, copy the code manually

**Build fails:**
- Run `npx tsc -b` alone to see TypeScript errors
- Make sure all deps are installed: `pnpm install`
