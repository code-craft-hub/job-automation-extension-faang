console.log('[CS] Content script loaded on:', window.location.href)

type ElementInfo = {
  tag: string
  type?: string
  label: string
  name?: string
  id?: string
  required: boolean
  visible: boolean
  href?: string
  value?: string
  options?: string[]
}

type HiddenInput = { name: string; id?: string; value?: string }

type FillInstruction = {
  name?: string
  id?: string
  label?: string
  value: string
  source?: string
}

type FillReport = {
  label: string
  value: string
  source: string
  status: 'filled' | 'failed' | 'not_found' | 'async'
}

type UnfilledField = {
  label: string
  name?: string
  id?: string
  type: string
  options?: string[]
}

const JOB_LINK_RE =
  /\b(apply|application|job|career|position|opening|vacancy|hiring|recruit|join.?us|work.?with.?us|opportunities)\b/i

const FINAL_SUBMIT_RE =
  /\b(submit|finish|done|(?:submit|send|complete)\s+(?:my\s+|your\s+|the\s+)?(?:application|application\s+form)|submit\s+now|send\s+now)\b/i

const CONTINUE_RE =
  /\b(continue|next|next step|save and continue|save & continue|proceed|go to next)\b/i

// Matches the visible text content of YES/NO boolean button components
const BOOL_BTN_YES_RE = /^\s*[✓✔☑]?\s*yes\s*$/i
const BOOL_BTN_NO_RE  = /^\s*[✗✘☒×]?\s*no\s*$/i

// ── Helpers ────────────────────────────────────────────────────────────────────

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function getLabel(el: Element): string {
  const get = (a: string) => el.getAttribute(a)?.trim() ?? ''

  const ariaLabel = get('aria-label')
  if (ariaLabel) return ariaLabel

  const labelledBy = get('aria-labelledby')
  if (labelledBy) {
    const text = labelledBy
      .split(/\s+/)
      .map((id) => document.getElementById(id)?.textContent?.trim() ?? '')
      .filter(Boolean)
      .join(' ')
    if (text) return text
  }

  const id = get('id')
  if (id) {
    try {
      const lbl = document.querySelector(`label[for="${CSS.escape(id)}"]`)
      const t = lbl?.textContent?.trim()
      if (t) return t
    } catch { /* noop */ }
  }

  let parent = el.parentElement
  while (parent && parent !== document.body) {
    if (parent.tagName === 'LABEL') return parent.textContent?.trim() ?? ''
    parent = parent.parentElement
  }

  // Sibling-label pattern: label/span is a preceding sibling of the field wrapper
  // (common in React form libs where <Label> and <Input> are siblings in a <div>)
  let scope: Element | null = el.parentElement
  for (let depth = 0; depth < 4 && scope; depth++) {
    for (const child of Array.from(scope.children)) {
      if (child === el || child.contains(el)) break // stop at the field itself
      if (!['LABEL', 'LEGEND', 'H3', 'H4', 'H5', 'SPAN', 'DIV', 'P'].includes(child.tagName)) continue
      if (child.querySelector('input,select,textarea,button,[role="combobox"],[aria-haspopup]')) continue
      const txt = child.textContent?.trim() ?? ''
      if (txt.length > 0 && txt.length < 100) return txt
    }
    scope = scope.parentElement
  }

  return get('placeholder') || get('name') || get('title') || get('id')
}

function isVisible(el: Element): boolean {
  try {
    const r = el.getBoundingClientRect()
    const s = window.getComputedStyle(el)
    return (
      r.width > 0 &&
      r.height > 0 &&
      s.display !== 'none' &&
      s.visibility !== 'hidden' &&
      s.opacity !== '0'
    )
  } catch {
    return false
  }
}

function isRequiredEl(el: Element): boolean {
  if (el.hasAttribute('required') || el.getAttribute('aria-required') === 'true') return true
  return /\*/.test(getLabel(el))
}

function info(el: Element, extra: Partial<ElementInfo> = {}): ElementInfo {
  return {
    tag: el.tagName.toLowerCase(),
    type: el.getAttribute('type') ?? undefined,
    label: getLabel(el),
    name: el.getAttribute('name') ?? undefined,
    id: el.getAttribute('id') ?? undefined,
    required: isRequiredEl(el),
    visible: isVisible(el),
    ...extra,
  }
}

function qAll(sel: string): Element[] {
  return Array.from(document.querySelectorAll(sel))
}

function getPageText(): string {
  const container =
    document.querySelector<HTMLElement>('main, article, [role="main"]') ??
    document.body
  return container.innerText.replace(/\s+/g, ' ').trim().slice(0, 3000)
}

// Walk open shadow roots to find additional elements (anti-bot pages may move buttons into shadow DOM).
function queryShadow(selector: string): HTMLElement[] {
  const found: HTMLElement[] = []
  function walk(root: Document | ShadowRoot) {
    root.querySelectorAll<HTMLElement>(selector).forEach((el) => found.push(el))
    root.querySelectorAll('*').forEach((el) => {
      if ((el as HTMLElement).shadowRoot) walk((el as HTMLElement).shadowRoot!)
    })
  }
  walk(document)
  return found
}

// Get the best visible text label from a button element.
function btnText(btn: HTMLElement): string {
  return (
    btn.textContent?.trim() ||
    btn.getAttribute('aria-label')?.trim() ||
    (btn as HTMLInputElement).value ||
    ''
  )
}

function findActionButton(): { btn: HTMLElement; text: string; isFinal: boolean } | null {
  const SEL = 'button, input[type="submit"], input[type="button"], [role="button"]'

  // Regular DOM + shadow DOM
  const candidates = [
    ...Array.from(document.querySelectorAll<HTMLElement>(SEL)),
    ...queryShadow(SEL).filter((el) => !document.contains(el)),
  ].filter((el) => {
    if (!isVisible(el)) return false
    // Include aria-hidden buttons — some SPAs hide buttons from a11y but keep them clickable
    return true
  })

  let finalBtn: HTMLElement | null = null
  let continueBtn: HTMLElement | null = null

  for (const btn of candidates) {
    const text = btnText(btn)
    if (!continueBtn && CONTINUE_RE.test(text)) continueBtn = btn
    if (!finalBtn && FINAL_SUBMIT_RE.test(text)) finalBtn = btn
  }

  if (finalBtn) return { btn: finalBtn, text: btnText(finalBtn), isFinal: true }
  if (continueBtn) return { btn: continueBtn, text: btnText(continueBtn), isFinal: false }

  const explicit = candidates.find(
    (b) => b.getAttribute('type') === 'submit' && !CONTINUE_RE.test(btnText(b)),
  )
  return explicit ? { btn: explicit, text: btnText(explicit), isFinal: true } : null
}

// ── Custom dropdown detection ──────────────────────────────────────────────────

function isCustomDropdown(el: Element): boolean {
  const tag = el.tagName.toLowerCase()
  if (tag === 'select' || tag === 'textarea') return false

  // Explicit ARIA combobox/listbox roles (any tag)
  const role = el.getAttribute('role')
  if (role === 'combobox' || role === 'listbox') return true

  // Elements with aria-haspopup (dropdown triggers regardless of tag)
  if (el.hasAttribute('aria-haspopup')) return true

  // Elements with aria-expanded (open/close state = definitely a dropdown)
  if (el.hasAttribute('aria-expanded')) return true

  // Read-only input inside styled dropdown container
  if (tag === 'input' && (el as HTMLInputElement).readOnly) {
    return !!(
      el.closest('[role="combobox"]') ||
      el.closest('[aria-haspopup]') ||
      el.closest('[aria-expanded]') ||
      el.closest('[class*="select"]') ||
      el.closest('[class*="Select"]') ||
      el.closest('[class*="dropdown"]') ||
      el.closest('[class*="Dropdown"]')
    )
  }

  // Button inside a dropdown/select container (Workable pattern)
  if (tag === 'button' || tag === 'div' || tag === 'span') {
    const container =
      el.closest('[class*="select"]') ??
      el.closest('[class*="Select"]') ??
      el.closest('[class*="dropdown"]') ??
      el.closest('[class*="Dropdown"]') ??
      el.closest('[data-automation*="select"]')
    if (container && container !== el) {
      // Only if this element looks like the trigger (has current value text or down-arrow)
      const txt = el.textContent?.trim() ?? ''
      if (txt && txt.length < 100) return true
    }
  }

  return false
}

// Returns the best clickable trigger element for a custom dropdown.
function findDropdownTrigger(el: Element): HTMLElement {
  const tag = el.tagName.toLowerCase()

  // Walk up to find the nearest container that controls the dropdown
  const container =
    el.closest('[aria-haspopup]') ??
    el.closest('[aria-expanded]') ??
    el.closest('[role="combobox"]') ??
    el.closest('[class*="select"]') ??
    el.closest('[class*="Select"]') ??
    el.closest('[class*="dropdown"]') ??
    el.closest('[class*="Dropdown"]') ??
    el.parentElement ??
    el

  // Prefer a button inside the container (common pattern)
  const innerBtn = container !== el
    ? container.querySelector<HTMLElement>('button, [role="button"]')
    : null
  if (innerBtn && isVisible(innerBtn)) return innerBtn

  // Prefer the container itself if it's visible and not just the root
  if (container !== el && isVisible(container as Element)) return container as HTMLElement

  // Fall back to the element itself
  if (tag === 'input') {
    // For read-only inputs, the parent div is usually the trigger
    const parent = el.parentElement
    if (parent && isVisible(parent)) return parent
  }

  return el as HTMLElement
}

// Normalize text for robust matching (handles curly quotes, extra spaces, etc.)
function normalizeText(s: string): string {
  return s
    .replace(/[‘’‚‛′‵]/g, "'")
    .replace(/[“”„‟″‶]/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .toLowerCase()
    .trim()
}

// Click a single option element reliably.
function clickOption(opt: HTMLElement): void {
  opt.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }))
  opt.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
  opt.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
  opt.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
  opt.click()
}

// Collect all visible option-like elements currently in the DOM.
function collectVisibleOptions(): HTMLElement[] {
  const OPTION_SEL = [
    '[role="option"]',
    '[role="menuitem"]',
    'li[data-value]',
    'li[data-id]',
    'li[data-key]',
    '[class*="option"]',
    '[class*="Option"]',
    'li',
  ].join(',')
  return Array.from(document.querySelectorAll<HTMLElement>(OPTION_SEL)).filter(isVisible)
}

// Read the Gemini API key stored by the side panel.
async function getStoredApiKey(): Promise<string | null> {
  return new Promise((resolve) => {
    chrome.storage.local.get('geminiApiKey', (r) => {
      resolve((r.geminiApiKey as string | undefined) ?? null)
    })
  })
}

// Ask Gemini to pick the single best option from a known list.
// Used when the initial fill value doesn't match any real option.
async function askGeminiToPickOption(
  apiKey: string,
  fieldLabel: string,
  optionTexts: string[],
): Promise<string | null> {
  const prompt = `You are filling a job application form field.

Field label: "${fieldLabel}"
Available options (pick exactly one):
${optionTexts.map((o, i) => `${i + 1}. ${o}`).join('\n')}

The applicant is a Software Engineer with 5 years of experience and a Bachelor's degree in Computer Science.
Reply with ONLY the exact text of the best matching option — no explanation, no punctuation around it.`

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
      },
    )
    if (!res.ok) return null
    const json = await res.json() as { candidates?: { content?: { parts?: { text?: string }[] } }[] }
    return json.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? null
  } catch {
    return null
  }
}

// Find the best matching option element from a list given a normalized needle.
function findBestMatch(options: HTMLElement[], needle: string): HTMLElement | null {
  // Exact match
  for (const opt of options) {
    const txt = normalizeText(opt.textContent ?? '')
    const dv  = normalizeText(opt.getAttribute('data-value') ?? opt.getAttribute('data-id') ?? '')
    if (txt === needle || dv === needle) return opt
  }
  // Partial / substring match
  for (const opt of options) {
    const txt = normalizeText(opt.textContent ?? '')
    const dv  = normalizeText(opt.getAttribute('data-value') ?? opt.getAttribute('data-id') ?? '')
    if (txt.includes(needle) || needle.includes(txt) || dv.includes(needle)) return opt
  }
  return null
}

// Open a custom dropdown and return the list of option elements that appeared.
async function openAndGetOptions(trigger: HTMLElement): Promise<HTMLElement[]> {
  const before = new Set(collectVisibleOptions())

  trigger.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
  trigger.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }))
  trigger.click()
  trigger.dispatchEvent(new FocusEvent('focus', { bubbles: true }))

  await delay(650)

  const after = collectVisibleOptions()
  const newOpts = after.filter(o => !before.has(o))
  // Prefer newly appeared (portal), but fall back to all visible if nothing new
  return newOpts.length > 0 ? newOpts : after
}

// Close any open dropdown overlay cleanly.
function closeDropdown(trigger: HTMLElement): void {
  trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  document.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
}

// Core fill routine: open → collect real options → resolve best pick → click.
async function fillCustomDropdown(el: Element, value: string): Promise<boolean> {
  const trigger = findDropdownTrigger(el)
  const label   = getLabel(el)

  // ── Step 1: Open and collect all available options ──────────────────────────
  const options = await openAndGetOptions(trigger)
  if (options.length === 0) {
    console.warn(`[CS] Custom dropdown "${label}": opened but no options found`)
    closeDropdown(trigger)
    return false
  }

  const optionTexts = [...new Set(
    options.map(o => o.textContent?.trim() ?? '').filter(t => t.length > 0 && t.length < 120)
  )]
  console.log(`[CS] Custom dropdown "${label}": ${optionTexts.length} options — ${optionTexts.slice(0, 5).join(', ')}...`)

  // ── Step 2: Resolve which option to click ───────────────────────────────────
  let targetText: string | null = null

  // 2a. Try matching against the Gemini-provided value directly
  const directMatch = findBestMatch(options, normalizeText(value))
  if (directMatch) {
    targetText = directMatch.textContent?.trim() ?? null
  }

  // 2b. If no match: ask Gemini to pick from the REAL option list
  if (!targetText) {
    console.log(`[CS] Custom dropdown "${label}": "${value}" not in list — asking Gemini...`)
    const apiKey = await getStoredApiKey()
    if (apiKey) {
      const picked = await askGeminiToPickOption(apiKey, label, optionTexts)
      console.log(`[CS] Custom dropdown "${label}": Gemini picked → "${picked}"`)
      if (picked) targetText = picked
    }
  }

  // 2c. Last resort: pick the first meaningful option (for required fields)
  if (!targetText) {
    if (isRequiredEl(el) && optionTexts[0]) {
      targetText = optionTexts[0]
      console.log(`[CS] Custom dropdown "${label}": fallback → first option "${targetText}"`)
    } else {
      closeDropdown(trigger)
      console.warn(`[CS] Custom dropdown "${label}": no suitable option found`)
      return false
    }
  }

  // ── Step 3: Click the resolved option ───────────────────────────────────────
  // Strategy A: use the search box to filter to exactly that option, then click
  const searchInput = Array.from(document.querySelectorAll<HTMLInputElement>(
    'input[type="search"], input[placeholder*="earch"], input[placeholder*="ilter"]'
  )).find(isVisible)

  if (searchInput) {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
    setter?.call(searchInput, targetText)
    searchInput.dispatchEvent(new Event('input', { bubbles: true }))
    searchInput.dispatchEvent(new Event('change', { bubbles: true }))
    await delay(350)

    const filtered = collectVisibleOptions()
    const hit = filtered.find(o => normalizeText(o.textContent ?? '').includes(normalizeText(targetText!)))
    if (hit) {
      clickOption(hit)
      console.log(`[CS] ✓ Custom dropdown "${label}" (search): "${hit.textContent?.trim()}"`)
      await delay(200)
      return true
    }
    // Search filtered to empty — clear the search box and fall through to direct click
    setter?.call(searchInput, '')
    searchInput.dispatchEvent(new Event('input', { bubbles: true }))
    await delay(250)
  }

  // Strategy B: direct click on the matching element in the collected options
  const target = findBestMatch(options, normalizeText(targetText))
  if (target && isVisible(target)) {
    clickOption(target)
    console.log(`[CS] ✓ Custom dropdown "${label}" (direct): "${target.textContent?.trim()}"`)
    await delay(150)
    return true
  }

  // Strategy C: re-collect after clearing search and try again
  const fresh = collectVisibleOptions()
  const freshHit = findBestMatch(fresh, normalizeText(targetText))
  if (freshHit) {
    clickOption(freshHit)
    console.log(`[CS] ✓ Custom dropdown "${label}" (re-collected): "${freshHit.textContent?.trim()}"`)
    await delay(150)
    return true
  }

  closeDropdown(trigger)
  console.warn(`[CS] Custom dropdown "${label}": could not click option "${targetText}"`)
  return false
}

// Open a custom dropdown, collect all option texts, then close it.
// Used during GET_JOB_ELEMENTS scan to give Gemini the real option list.
async function extractDropdownOptions(el: Element): Promise<string[]> {
  const trigger = findDropdownTrigger(el)
  const options = await openAndGetOptions(trigger)
  const texts = [...new Set(
    options.map(o => o.textContent?.trim() ?? '').filter(t => t.length > 0 && t.length < 120)
  )]
  closeDropdown(trigger)
  await delay(250)
  return texts
}

// ── Phone field helpers ────────────────────────────────────────────────────────

function hasCountrySelector(el: Element): boolean {
  const parent = el.parentElement
  const ancestor = el.closest('[class*="phone"], [class*="Phone"], [class*="tel"], .iti')
  const scope = ancestor ?? parent

  if (!scope) return false
  return !!(
    scope.querySelector('.iti__flag, .iti__flag-box, [class*="flag"]') ||
    scope.querySelector('[class*="country-code"], [class*="CountryCode"], [class*="countryCode"]') ||
    scope.querySelector('[class*="phone-code"], [class*="phoneCode"]') ||
    (scope.querySelector('select') && scope.querySelector('select') !== el) ||
    (scope.querySelector('[role="combobox"]') && scope.querySelector('[role="combobox"]') !== el)
  )
}

function stripCountryCode(phone: string): string {
  return phone
    .replace(/^\+\d{1,3}[-\s]?/, '')   // +XX or +XXX
    .replace(/^00\d{1,3}[-\s]?/, '')   // 00XX
    .trim()
}

// ── Resume upload ──────────────────────────────────────────────────────────────

// Returns true only for file inputs that expect a resume/CV (not photos, logos, etc.)
function isResumeInput(fi: HTMLInputElement): boolean {
  const accept = (fi.getAttribute('accept') ?? '').toLowerCase()
  const label  = getLabel(fi).toLowerCase()

  // Image-only accept → definitely not a resume field
  if (/image\/|\.jpg|\.jpeg|\.png|\.gif|\.webp/.test(accept) && !accept.includes('pdf')) return false
  // Label clearly says photo/picture/image/avatar → skip
  if (/\b(photo|picture|image|avatar|headshot|profile\s*pic|logo)\b/.test(label)) return false

  // Explicitly resume/CV by label or accept attribute → yes
  if (/\b(resume|cv|curriculum)\b/.test(label) || accept.includes('pdf')) return true

  // Generic file input with no clear signal → assume resume
  return true
}

async function uploadResume(input: HTMLInputElement): Promise<boolean> {
  try {
    const url = chrome.runtime.getURL('public/cverai.resume.pdf')
    const res = await fetch(url)
    if (!res.ok) { console.warn('[CS] Resume fetch failed:', res.status); return false }
    const blob = await res.blob()
    const file = new File([blob], 'John_Doe_Resume.pdf', { type: 'application/pdf' })
    const dt = new DataTransfer()
    dt.items.add(file)

    // Pin our DataTransfer to the `files` getter with defineProperty so that
    // even if the site calls `input.value = ''` (a common reset pattern that
    // normally clears the native FileList), reads of `input.files` always
    // return our file — preventing it from "going away" after React re-renders.
    try {
      Object.defineProperty(input, 'files', {
        get: () => dt.files,
        configurable: true,
      })
    } catch {
      // Fallback if defineProperty is blocked (e.g. already non-configurable)
      input.files = dt.files
    }

    // Dispatch native DOM events — React 17+ delegates at the root container,
    // so these reach React's synthetic event system correctly.
    input.dispatchEvent(new Event('change', { bubbles: true }))
    input.dispatchEvent(new Event('input', { bubbles: true }))

    // Also call React's own onChange handler directly when present.
    // React 17 stores props under __reactProps$<hash>, React 16 under __reactEventHandlers$<hash>.
    // Calling it directly ensures react-hook-form / formik update their internal state
    // even when isTrusted=false events are filtered.
    const reactKey = Object.keys(input).find(
      (k) => k.startsWith('__reactEventHandlers') || k.startsWith('__reactProps'),
    )
    if (reactKey) {
      const rProps = (input as unknown as Record<string, Record<string, unknown>>)[reactKey]
      const onChange = rProps?.onChange
      if (typeof onChange === 'function') {
        onChange({
          target: input, currentTarget: input, type: 'change',
          bubbles: true, cancelable: true, isTrusted: false,
          preventDefault: () => {}, stopPropagation: () => {},
        })
        console.log('[CS] ✓ Resume: React internal onChange called')
      }
    }

    // Wait for any async upload flow (e.g. Workable's presign → S3 PUT) to settle
    // before we move on to filling other fields that might trigger re-renders.
    await delay(800)
    console.log('[CS] ✓ Resume uploaded to file input')
    return true
  } catch (e) {
    console.warn('[CS] Resume upload error:', e)
    return false
  }
}

// ── Fill element ───────────────────────────────────────────────────────────────

// Returns true on success, false on failure, 'custom' for async dropdown handling.
function fillElement(el: Element, value: string): boolean | 'custom' {
  const tag = el.tagName.toLowerCase()
  const type = el.getAttribute('type')?.toLowerCase()

  // Custom dropdown — caller must use fillCustomDropdown() instead
  if (isCustomDropdown(el)) return 'custom'

  // File upload — handled separately in the FILL_AND_SUBMIT async block
  if (type === 'file') return false

  let filled = false

  // YES/NO boolean button — just click it (resolveElement already picked the right one)
  if (tag === 'button') {
    const btnText = (el as HTMLElement).textContent?.trim() ?? ''
    // Guard: do not click form-action buttons accidentally
    if (FINAL_SUBMIT_RE.test(btnText) || CONTINUE_RE.test(btnText)) return false
    ;(el as HTMLElement).click()
    return true
  }

  if (tag === 'select') {
    const sel = el as HTMLSelectElement
    const option = Array.from(sel.options).find(
      (o) =>
        o.value.toLowerCase() === value.toLowerCase() ||
        o.text.toLowerCase().includes(value.toLowerCase()),
    )
    if (!option) { console.warn(`[CS] No matching option for value="${value}"`); return false }
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set
    setter?.call(sel, option.value)
    sel.dispatchEvent(new Event('change', { bubbles: true }))
    filled = true

  } else if (type === 'checkbox') {
    const cb = el as HTMLInputElement
    const shouldCheck = ['true', '1', 'yes', 'checked', 'on'].includes(value.toLowerCase())
    if (cb.checked !== shouldCheck) cb.click()
    filled = true

  } else if (type === 'radio') {
    const name = el.getAttribute('name')
    if (name) {
      try {
        const target = Array.from(
          document.querySelectorAll<HTMLInputElement>(`input[type="radio"][name="${CSS.escape(name)}"]`),
        ).find((r) => r.value.toLowerCase() === value.toLowerCase())
        if (!target) { console.warn(`[CS] No radio value="${value}" in group="${name}"`); return false }
        if (!target.checked) target.click()
        filled = true
      } catch { return false }
    }

  } else if (tag === 'textarea') {
    const ta = el as HTMLTextAreaElement
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
    setter?.call(ta, value)
    ta.dispatchEvent(new Event('input', { bubbles: true }))
    ta.dispatchEvent(new Event('change', { bubbles: true }))
    filled = true

  } else {
    // Standard text / email / tel / number input
    const input = el as HTMLInputElement
    const isPhone = type === 'tel' || /phone|mobile|telephone/i.test(getLabel(el))
    const fillValue = (isPhone && hasCountrySelector(el)) ? stripCountryCode(value) : value

    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
    setter?.call(input, fillValue)
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new Event('change', { bubbles: true }))
    filled = true
  }

  if (filled) {
    el.dispatchEvent(new Event('blur', { bubbles: true }))
    el.dispatchEvent(new Event('focusout', { bubbles: true }))
  }

  return filled
}

// ── YES/NO boolean question helpers ──────────────────────────────────────────

// Returns true when a YES/NO button pair is "answered" (one button is selected/active).
function isBoolAnswered(parent: Element): boolean {
  const btns = Array.from(parent.querySelectorAll<HTMLElement>('button'))
  return btns.some((b) => {
    const ap = b.getAttribute('aria-pressed')
    const as_ = b.getAttribute('aria-selected')
    const ds = b.getAttribute('data-selected') ?? b.getAttribute('data-active')
    const cl = b.classList
    if (ap === 'true' || as_ === 'true' || ds === 'true') return true
    if (cl.contains('selected') || cl.contains('active') || cl.contains('checked')) return true
    // Heuristic: background colour differs from siblings (active button is highlighted)
    const bg = window.getComputedStyle(b).backgroundColor
    return btns.filter(o => o !== b).some(o => window.getComputedStyle(o).backgroundColor !== bg)
  })
}

// Find the YES button or NO button for a given question label text.
// Looks in heading/label/legend elements, then walks up to find the button pair.
function findYesNoButton(questionLabel: string, answer: 'yes' | 'no'): HTMLElement | null {
  const needle = questionLabel.toLowerCase().replace(/[*\s]+/g, ' ').trim()
  const targetRE = answer === 'yes' ? BOOL_BTN_YES_RE : BOOL_BTN_NO_RE

  const HEADING_SEL = 'label, legend, h1, h2, h3, h4, h5, p, div, span, [class*="label"], [class*="question"]'
  for (const el of Array.from(document.querySelectorAll<HTMLElement>(HEADING_SEL))) {
    const txt = (el.textContent ?? '').toLowerCase().replace(/[*\s]+/g, ' ').trim()
    if (!txt || txt.length > 300) continue
    if (!txt.includes(needle) && !needle.includes(txt)) continue

    // Walk up to find a container that also holds the YES/NO buttons
    let scope: Element | null = el
    for (let i = 0; i < 6 && scope; i++) {
      const btn = Array.from(scope.querySelectorAll<HTMLElement>('button'))
        .find((b) => targetRE.test(b.textContent?.trim() ?? '') && isVisible(b))
      if (btn) return btn
      scope = scope.parentElement
    }
  }
  return null
}

// ── Resolve element ────────────────────────────────────────────────────────────

// Tracks which custom dropdowns have already been claimed by positional fallback
// so that two empty-label fills don't both resolve to the first dropdown.
const _positionalClaimed = new Set<Element>()

function resolveElement(instr: FillInstruction): Element | null {
  // YES/NO boolean buttons — special path before generic resolution
  if (instr.value && /^(yes|no)$/i.test(instr.value) && instr.label) {
    const btn = findYesNoButton(instr.label, instr.value.toLowerCase() as 'yes' | 'no')
    if (btn) return btn
  }

  if (instr.name) {
    try {
      const el = document.querySelector(`[name="${CSS.escape(instr.name)}"]`)
      if (el) return el
    } catch { /* noop */ }
  }
  if (instr.id) {
    const el = document.getElementById(instr.id)
    if (el) return el
  }
  // Label-text fallback (guard against empty needle)
  const needle = (instr.label ?? '').toLowerCase().replace(/[*\s]+/g, ' ').trim()
  if (needle) {
    for (const lbl of Array.from(document.querySelectorAll<HTMLElement>('label'))) {
      const t = (lbl.textContent ?? '').toLowerCase().replace(/[*\s]+/g, ' ').trim()
      if (!t || (!t.includes(needle) && !needle.includes(t))) continue
      const forId = lbl.getAttribute('for')
      if (forId) {
        const el = document.getElementById(forId)
        if (el) return el
      }
      const nested = lbl.querySelector('input, select, textarea, [role="combobox"], [aria-haspopup]')
      if (nested) return nested
    }
    // Match by placeholder / aria-label / name on any form-like element
    for (const el of qAll('input, select, textarea, [role="combobox"], [aria-haspopup], [aria-expanded]')) {
      const lbl2 = getLabel(el).toLowerCase().replace(/[*\s]+/g, ' ').trim()
      if (lbl2 && (lbl2.includes(needle) || needle.includes(lbl2))) return el
    }
  }

  // Positional fallback: fill has no label/name/id (e.g. SmartRecruiters unlabeled dropdowns)
  // Claim the next unclaimed visible custom dropdown in DOM order.
  if (!needle && !instr.name && !instr.id && isCustomDropdown_value(instr.value)) {
    for (const el of qAll('[aria-haspopup], [aria-expanded], [role="combobox"], input[readonly]')) {
      if (!isVisible(el) || !isCustomDropdown(el)) continue
      if (_positionalClaimed.has(el)) continue
      _positionalClaimed.add(el)
      return el
    }
  }

  return null
}

// Returns true if the value looks like a dropdown selection (not a free-text answer).
function isCustomDropdown_value(val: string): boolean {
  if (!val) return false
  // Short values (1-4 words) with title-cased words are likely dropdown options
  const words = val.trim().split(/\s+/)
  return words.length <= 5 && words.every(w => /^[A-Z]/.test(w) || /^[0-9]/.test(w))
}

// ── Unfilled required fields scan ─────────────────────────────────────────────

function getUnfilledRequired(): UnfilledField[] {
  const result: UnfilledField[] = []
  const seen = new Set<string>()

  function add(f: UnfilledField) {
    const key = f.name ?? f.id ?? f.label
    if (seen.has(key)) return
    seen.add(key)
    result.push(f)
  }

  // Text / email / tel / textarea — EXCLUDE custom dropdown inputs (they're handled below)
  const TEXT_SEL = [
    'input[type="text"]:not([readonly])',
    'input[type="email"]:not([readonly])',
    'input[type="tel"]:not([readonly])',
    'input[type="number"]:not([readonly])',
    'input[type="url"]:not([readonly])',
    'input:not([type]):not([readonly])',
    'textarea',
  ].join(',')
  for (const el of qAll(TEXT_SEL)) {
    if (!isVisible(el)) continue
    if (isCustomDropdown(el)) continue // skip — handled in custom_select scan
    const inp = el as HTMLInputElement | HTMLTextAreaElement
    if (isRequiredEl(el) && !inp.value.trim()) {
      add({
        label: getLabel(el),
        name: inp.name || undefined,
        id: inp.id || undefined,
        type: el.tagName.toLowerCase() === 'textarea' ? 'textarea' : ((inp as HTMLInputElement).type || 'text'),
      })
    }
  }

  // Native selects
  for (const el of qAll('select')) {
    if (!isVisible(el)) continue
    const sel = el as HTMLSelectElement
    if (isRequiredEl(el) && (!sel.value || sel.selectedIndex <= 0)) {
      const options = Array.from(sel.options).slice(1).map((o) => o.value || o.text.trim()).filter(Boolean)
      add({ label: getLabel(el), name: sel.name || undefined, id: sel.id || undefined, type: 'select', options })
    }
  }

  // Custom dropdowns: role=combobox, aria-haspopup, or read-only inputs inside styled containers
  const CUSTOM_SEL = '[role="combobox"], [aria-haspopup], input[readonly]'
  for (const el of qAll(CUSTOM_SEL)) {
    if (!isVisible(el)) continue
    if (!isRequiredEl(el)) continue
    const val = (el as HTMLInputElement).value?.trim() ?? el.textContent?.trim() ?? ''
    if (!val || val.toLowerCase().startsWith('select') || val.toLowerCase() === 'choose') {
      const id = el.getAttribute('id') || undefined
      const name = el.getAttribute('name') || undefined
      add({ label: getLabel(el), name, id, type: 'custom_select' })
    }
  }

  // Radio groups
  const radioGroups = new Map<string, HTMLInputElement[]>()
  for (const el of qAll('input[type="radio"]')) {
    const r = el as HTMLInputElement
    if (!r.name) continue
    if (!radioGroups.has(r.name)) radioGroups.set(r.name, [])
    radioGroups.get(r.name)!.push(r)
  }
  for (const [name, radios] of radioGroups) {
    if (!radios.some((r) => isVisible(r))) continue
    if (!radios.some((r) => isRequiredEl(r))) continue
    if (radios.some((r) => r.checked)) continue
    add({
      label: getLabel(radios[0]),
      name,
      id: undefined,
      type: 'radio',
      options: [...new Set(radios.map((r) => r.value).filter(Boolean))],
    })
  }

  // Fields in aria-invalid error state
  for (const el of qAll('[aria-invalid="true"]')) {
    if (!isVisible(el)) continue
    const name = el.getAttribute('name') || undefined
    const id = el.getAttribute('id') || undefined
    if (name || id) add({ label: getLabel(el), name, id, type: 'invalid' })
  }

  // YES/NO boolean button pairs that have not been answered
  const seenBoolParents = new Set<Element>()
  for (const btn of qAll('button')) {
    if (!isVisible(btn)) continue
    if (!BOOL_BTN_YES_RE.test(btn.textContent?.trim() ?? '')) continue
    const parent = btn.parentElement
    if (!parent || seenBoolParents.has(parent)) continue

    const noBtn = Array.from(parent.querySelectorAll<HTMLElement>('button'))
      .find(b => BOOL_BTN_NO_RE.test(b.textContent?.trim() ?? '') && isVisible(b))
    if (!noBtn) continue

    seenBoolParents.add(parent)
    if (isBoolAnswered(parent)) continue // already answered

    // Find the question label text
    const section = parent.closest('[class*="question"], fieldset, section') ?? parent.parentElement?.parentElement ?? parent.parentElement
    const questionEl = section
      ? Array.from(section.querySelectorAll('label, legend, h3, h4, p, [class*="label"], [class*="question"]'))
          .find(e => e !== parent && (e.textContent?.trim() ?? '').length > 0)
      : null
    const label = questionEl?.textContent?.trim().replace(/\s+/g, ' ') ?? 'Boolean question'
    const isReq = /\*/.test(label)
    if (isReq) add({ label, type: 'yes_no', options: ['yes', 'no'] })
  }

  return result
}

// ── Message listener ───────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const type = message.type as string
  console.log(`[CS] Message: ${type}`)

  // ── EXPAND_PROFILE_SECTIONS ──────────────────────────────────────────────────
  // Clicks "Add Education" / "Add Experience" / "Add" buttons inside profile sections
  // so their form fields become visible before scanning.
  if (type === 'EXPAND_PROFILE_SECTIONS') {
    ;(async () => {
      const ADD_SECTION_RE =
        /^\+?\s*(add\s+education|add\s+experience|add\s+work\s+experience|add\s+qualification|add\s+another|add\s+new|add)\s*$/i

      const buttons = Array.from(
        document.querySelectorAll<HTMLElement>('button, [role="button"], a')
      ).filter((el) => {
        if (!isVisible(el)) return false
        const txt = el.textContent?.trim() ?? ''
        return ADD_SECTION_RE.test(txt)
      })

      let expanded = 0
      for (const btn of buttons) {
        // Only click if the section doesn't already have visible inputs
        const section =
          btn.closest('section') ??
          btn.closest('[class*="section"]') ??
          btn.closest('[class*="profile"]') ??
          btn.parentElement?.parentElement
        const alreadyOpen = section
          ? section.querySelector('input:not([type="hidden"]), textarea, select') !== null &&
            Array.from(section.querySelectorAll<HTMLInputElement>('input:not([type="hidden"])')).some(isVisible)
          : false
        if (!alreadyOpen) {
          console.log(`[CS] Expanding section: "${btn.textContent?.trim()}"`)
          btn.click()
          expanded++
          await delay(400)
        }
      }
      if (expanded > 0) await delay(300) // extra settle time
      sendResponse({ expanded })
    })()
    return true
  }

  // ── GET_JOB_ELEMENTS ─────────────────────────────────────────────────────────
  if (type === 'GET_JOB_ELEMENTS') {
    // Async: pre-fetches option lists from custom dropdowns before responding
    ;(async () => {
    console.log('[CS] Scanning...')

    const TEXT_TYPES = ['text', 'email', 'tel', 'number', 'url', 'search', 'password']
    const textFields = qAll(
      [...TEXT_TYPES.map((t) => `input[type="${t}"]`), 'input:not([type])'].join(','),
    ).map((el) => info(el))

    const DATE_TYPES = ['date', 'datetime-local', 'month', 'week', 'time']
    const dateFields = qAll(DATE_TYPES.map((t) => `input[type="${t}"]`).join(',')).map((el) => info(el))

    const fileUploads = qAll('input[type="file"]').map((el) =>
      info(el, { value: el.getAttribute('accept') ?? undefined }),
    )
    const checkboxes = qAll('input[type="checkbox"]').map((el) =>
      info(el, { value: (el as HTMLInputElement).checked ? 'checked' : 'unchecked' }),
    )
    const radios = qAll('input[type="radio"]').map((el) =>
      info(el, { value: (el as HTMLInputElement).value || undefined }),
    )
    const dropdowns = qAll('select').map((el) => {
      const options = Array.from((el as HTMLSelectElement).options).map((o) => o.text.trim()).filter(Boolean)
      return { ...info(el), options }
    })
    const textareas = qAll('textarea').map((el) => info(el))

    const BUTTON_SEL = 'button,input[type="submit"],input[type="button"],input[type="reset"],input[type="image"]'
    const buttons = qAll(BUTTON_SEL).map((el) =>
      info(el, { value: ((el as HTMLInputElement).value?.trim() || el.textContent?.trim()) ?? undefined }),
    )
    const navigationLinks = qAll('a[href]')
      .filter((el) => JOB_LINK_RE.test(el.textContent ?? '') || JOB_LINK_RE.test((el as HTMLAnchorElement).href))
      .map((el) => info(el, { href: (el as HTMLAnchorElement).href, value: el.textContent?.trim() || undefined }))

    const APPLY_RE = /\b(apply|apply now|apply for this job|start application|begin application)\b/i
    const applyButtons = [
      ...qAll('button').filter((el) => APPLY_RE.test(el.textContent ?? '') && isVisible(el)),
      ...qAll('a[href]').filter((el) => APPLY_RE.test(el.textContent ?? '') && isVisible(el)),
    ].map((el) => info(el, {
      href: el.tagName === 'A' ? (el as HTMLAnchorElement).href : undefined,
      value: el.textContent?.trim() || (el as HTMLInputElement).value?.trim() || undefined,
    }))

    // Contextual apply links: <a> tags whose surrounding text says "to apply" / "method of application"
    // (e.g. "Go to Cavista on jobs.smartrecruiters.com to apply")
    const APPLY_CONTEXT_RE = /\b(method of application|how to apply|to apply|apply (at|on|via|through)|apply here)\b/i
    const seenApplyHrefs = new Set(applyButtons.map((b) => b.href).filter(Boolean))
    for (const a of Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href]'))) {
      if (!isVisible(a)) continue
      const href = a.href
      if (!href || href === window.location.href || href.startsWith('javascript') || href.endsWith('#')) continue
      if (seenApplyHrefs.has(href)) continue
      if (/facebook|twitter|instagram|youtube|mailto:|tel:/i.test(href)) continue
      const ctx = a.closest('p, li, div, section, article')?.textContent ?? ''
      if (!APPLY_CONTEXT_RE.test(ctx)) continue
      seenApplyHrefs.add(href)
      applyButtons.push(info(a, { href, value: a.textContent?.trim() || href }))
    }

    const richTextEditors = qAll('[contenteditable="true"]')
      .filter((el) => !['INPUT', 'SELECT', 'TEXTAREA'].includes(el.tagName))
      .map((el) => info(el))

    const ARIA_ROLES = ['textbox', 'combobox', 'listbox', 'spinbutton', 'slider', 'switch', 'searchbox']
    const customComponents = qAll(ARIA_ROLES.map((r) => `[role="${r}"]`).join(','))
      .filter((el) => !['INPUT', 'SELECT', 'TEXTAREA', 'BUTTON'].includes(el.tagName))
      .map((el) => info(el))

    // Custom dropdowns: detect triggers using multiple strategies, then open each
    // briefly to extract the REAL available options before asking Gemini.
    //
    // Strategy 1: ARIA attributes (standard)
    // Strategy 2: "Select an option…" placeholder text (Workable / most custom selects)
    // Strategy 3: isCustomDropdown() match on common candidates
    const PLACEHOLDER_RE = /^(select an option|select\.\.\.|choose\.\.\.|please select|choose an option)\.?\.?\.?$/i

    const candidateEls: Element[] = []
    const seen = new Set<Element>()
    function addCandidate(el: Element) {
      if (!seen.has(el) && isVisible(el)) { seen.add(el); candidateEls.push(el) }
    }

    // ARIA-based
    for (const el of qAll('[aria-haspopup], [aria-expanded], [role="combobox"]')) addCandidate(el)
    // Placeholder-text-based (Workable pattern: div/button that shows "Select an option...")
    for (const el of qAll('button, [role="button"], div, span')) {
      const txt = el.textContent?.trim() ?? ''
      if (PLACEHOLDER_RE.test(txt)) addCandidate(el)
    }
    // Read-only inputs inside styled containers
    for (const el of qAll('input[readonly]')) {
      if (isCustomDropdown(el)) addCandidate(el)
    }

    const customSelectEls = candidateEls.filter((el) => {
      if (['SELECT', 'TEXTAREA'].includes(el.tagName)) return false
      const txt = el.textContent?.trim() ?? ''
      if (APPLY_RE.test(txt) || CONTINUE_RE.test(txt) || FINAL_SUBMIT_RE.test(txt)) return false
      return true
    })

    const customSelects: ElementInfo[] = []
    for (const el of customSelectEls) {
      const currentVal = (el as HTMLInputElement).value?.trim() || el.textContent?.trim() || ''
      // Open the dropdown briefly to get the real option list
      const opts = await extractDropdownOptions(el)
      customSelects.push(info(el, {
        value: currentVal || undefined,
        options: opts.length > 0 ? opts : undefined,
      }))
    }

    const hiddenInputs: HiddenInput[] = qAll('input[type="hidden"]').map((el) => ({
      name: (el as HTMLInputElement).name || '',
      id: el.getAttribute('id') ?? undefined,
      value: (el as HTMLInputElement).value || undefined,
    }))

    // YES/NO boolean question button pairs (Workable custom boolean components)
    const yesNoQuestions: ElementInfo[] = []
    const seenBoolParents = new Set<Element>()
    for (const btn of qAll('button')) {
      if (!isVisible(btn)) continue
      if (!BOOL_BTN_YES_RE.test(btn.textContent?.trim() ?? '')) continue
      const parent = btn.parentElement
      if (!parent || seenBoolParents.has(parent)) continue

      const noBtn = Array.from(parent.querySelectorAll<HTMLElement>('button'))
        .find(b => BOOL_BTN_NO_RE.test(b.textContent?.trim() ?? '') && isVisible(b))
      if (!noBtn) continue

      seenBoolParents.add(parent)

      // Extract the question label from the nearest heading/label element
      const section = parent.closest('[class*="question"], fieldset, section') ?? parent.parentElement?.parentElement ?? parent.parentElement
      const questionEl = section
        ? Array.from(section.querySelectorAll('label, legend, h3, h4, p, [class*="label"], [class*="question"]'))
            .find(e => e !== parent && (e.textContent?.trim() ?? '').length > 0)
        : null
      const label = questionEl?.textContent?.trim().replace(/\s+/g, ' ') ?? 'Yes/No question'
      const isAnswered = isBoolAnswered(parent)

      yesNoQuestions.push({
        tag: 'button',
        type: 'yes_no',
        label,
        required: /\*/.test(label),
        visible: true,
        value: isAnswered ? 'answered' : undefined,
        options: ['yes', 'no'],
      })
    }

    const categories = {
      textFields, dateFields, fileUploads, checkboxes, radios,
      dropdowns, textareas, buttons, navigationLinks, applyButtons, richTextEditors,
      customComponents, customSelects, yesNoQuestions, hiddenInputs,
    }
    const totals = Object.fromEntries(Object.entries(categories).map(([k, v]) => [k, v.length]))

    // Detect action button during scan so the side panel can log it immediately
    const scannedAction = findActionButton()
    const detectedActionButton = scannedAction
      ? { text: scannedAction.text, isFinal: scannedAction.isFinal }
      : null

    console.log('[CS] Scan complete:', totals, '| action button:', detectedActionButton?.text ?? 'none')
    sendResponse({
      url: window.location.href,
      title: document.title,
      pageText: getPageText(),
      categories,
      totals,
      detectedActionButton,
    })
    })() // end async IIFE
    return true
  }

  // ── FILL_AND_SUBMIT ───────────────────────────────────────────────────────────
  if (type === 'FILL_AND_SUBMIT') {
    ;(async () => {
      // Reset positional dropdown claim tracker for this fill cycle
      _positionalClaimed.clear()

      const fills = (message.fills ?? []) as FillInstruction[]
      const submitForm = message.submitForm !== false
      console.log(`[CS] FILL_AND_SUBMIT: ${fills.length} fills, submitForm=${submitForm}`)

      const report: FillReport[] = []
      let filledCount = 0
      const customQueue: { el: Element; value: string; label: string; source: string }[] = []

      // ── 0. Upload resume to file inputs ────────────────────────────────────
      // File inputs are always CSS-hidden on modern job boards (triggered by a styled button).
      // Do NOT filter by isVisible — only filter by isResumeInput to skip photo/logo fields.
      const fileInputs = Array.from(document.querySelectorAll<HTMLInputElement>('input[type="file"]'))
        .filter(isResumeInput)
      for (const fi of fileInputs) {
        const ok = await uploadResume(fi)
        if (ok) {
          filledCount++
          report.push({ label: getLabel(fi) || 'Resume', value: 'cverai.resume.pdf', source: 'demo_user', status: 'filled' })
        }
      }

      // ── 1. Sync fill pass ──────────────────────────────────────────────────
      for (const instr of fills) {
        const el = resolveElement(instr)
        const labelKey = instr.label ?? instr.name ?? instr.id ?? '?'

        if (!el) {
          console.warn(`[CS] Not found: ${labelKey}`)
          report.push({ label: labelKey, value: instr.value, source: instr.source ?? 'unknown', status: 'not_found' })
          continue
        }

        const result = fillElement(el, instr.value)

        if (result === 'custom') {
          customQueue.push({ el, value: instr.value, label: labelKey, source: instr.source ?? 'unknown' })
          report.push({ label: labelKey, value: instr.value, source: instr.source ?? 'unknown', status: 'async' })
          filledCount++ // optimistic; corrected below if it fails
        } else if (result) {
          console.log(`[CS] ✓ "${labelKey}" = "${instr.value}" [${instr.source ?? '?'}]`)
          report.push({ label: labelKey, value: instr.value, source: instr.source ?? 'unknown', status: 'filled' })
          filledCount++
        } else {
          console.warn(`[CS] ✗ Failed: "${labelKey}"`)
          report.push({ label: labelKey, value: instr.value, source: instr.source ?? 'unknown', status: 'failed' })
        }
      }

      // ── 2. Async custom dropdown pass ────────────────────────────────────
      if (customQueue.length > 0) {
        console.log(`[CS] Async custom dropdown fills: ${customQueue.length}`)
        for (const item of customQueue) {
          const ok = await fillCustomDropdown(item.el, item.value)
          const entry = report.find((r) => r.label === item.label && r.status === 'async')
          if (!ok) {
            if (entry) { entry.status = 'failed'; filledCount-- }
          } else {
            if (entry) entry.status = 'filled'
            console.log(`[CS] ✓ Custom dropdown "${item.label}" = "${item.value}"`)
          }
        }
        await delay(300)
      }

      // ── 3. Click section-level Save buttons (Education/Experience entries) ──
      // These are "Save" buttons inside profile sections (not the main form action).
      const SECTION_SAVE_RE = /^(save|done|add entry|save entry)$/i
      const sectionSaveBtns = Array.from(
        document.querySelectorAll<HTMLElement>('button:not([type="submit"])')
      ).filter((el) => {
        if (!isVisible(el)) return false
        const txt = el.textContent?.trim() ?? ''
        if (!SECTION_SAVE_RE.test(txt)) return false
        if (CONTINUE_RE.test(txt) || FINAL_SUBMIT_RE.test(txt)) return false
        // Only inside a section that also has visible inputs (it's a subsection, not main form)
        const ancestor = el.closest('section, [class*="section"], [class*="profile"], [class*="entry"], div')
        return !!(ancestor && ancestor.querySelector('input:not([type="hidden"]), textarea'))
      })
      for (const btn of sectionSaveBtns) {
        console.log(`[CS] Clicking section save: "${btn.textContent?.trim()}"`)
        btn.click()
        await delay(300)
      }

      // ── 4. Scan still-unfilled required fields ──────────────────────────────
      await delay(200) // let React settle after section saves
      const unfilledRequired = getUnfilledRequired()
      if (unfilledRequired.length > 0) {
        console.log(`[CS] Unfilled required (${unfilledRequired.length}):`, unfilledRequired.map((f) => f.label))
      }

      const action = submitForm ? findActionButton() : null

      // Only block the FINAL submit when the DOM scan still sees empty required fields.
      // Failed fills for optional fields should NOT prevent submission.
      // Continue buttons are never blocked — server validation will handle errors.
      const shouldBlock = action?.isFinal && unfilledRequired.length > 0
      const effectiveAction = shouldBlock ? null : action

      if (shouldBlock) {
        console.warn(`[CS] Blocking submit — ${unfilledRequired.length} required field(s) still empty`)
      }

      const actionButtonText = action?.text ?? null
      if (submitForm) {
        console.log(`[CS] Action button: ${action ? `"${action.text}" isFinal=${action.isFinal}` : 'not found'}${shouldBlock ? ' → BLOCKED' : ''}`)
      }

      if (effectiveAction?.isFinal) {
        // ── Final submit: click → wait → check for validation errors → respond ──
        // Delay sendResponse until AFTER the error check so we can report failures accurately.
        console.log('[CS] Clicking final submit...')
        effectiveAction.btn.click()
        await delay(800) // long enough for React validation, short enough before page unloads

        const ERROR_SEL = [
          '[aria-invalid="true"]',
          '[role="alert"]',
          '[class*="error"][class*="message"]',
          '[class*="ErrorMessage"]',
          '[class*="error-text"]',
          '[class*="field-error"]',
          '.error',
        ].join(',')
        const visibleErrors = Array.from(document.querySelectorAll<HTMLElement>(ERROR_SEL))
          .filter((el) => isVisible(el) && (el.textContent?.trim() ?? '').length > 0)

        if (visibleErrors.length > 0) {
          const msgs = visibleErrors.map((e) => e.textContent!.trim().slice(0, 80))
          console.warn('[CS] Submit validation errors:', msgs)
          sendResponse({
            filled: filledCount,
            submitted: false,
            pageAction: 'none' as const,
            actionButtonText,
            report,
            url: window.location.href,
            title: document.title,
            unfilledRequired: [
              ...unfilledRequired,
              ...msgs.map((m) => ({ label: m, type: 'invalid' as const })),
            ],
          })
        } else {
          console.log('[CS] No validation errors — submit looks clean.')
          sendResponse({
            filled: filledCount,
            submitted: true,
            pageAction: 'submitted' as const,
            actionButtonText,
            report,
            url: window.location.href,
            title: document.title,
            unfilledRequired,
          })
        }

      } else {
        // ── Continue or no action: respond immediately, then click ──────────────
        const pageAction = effectiveAction ? 'continued' : 'none'
        sendResponse({
          filled: filledCount,
          submitted: false,
          pageAction: pageAction as 'continued' | 'none',
          actionButtonText,
          report,
          url: window.location.href,
          title: document.title,
          unfilledRequired,
        })
        if (effectiveAction) {
          setTimeout(() => {
            console.log('[CS] Clicking continue...')
            effectiveAction.btn.click()
          }, 200)
        }
      }
    })()
    return true
  }

  // ── CLICK_BUTTON ─────────────────────────────────────────────────────────────
  if (type === 'CLICK_BUTTON') {
    const text = (message.buttonText ?? '') as string
    const APPLY_RE = /\b(apply|apply now|apply for this job|start application|begin application)\b/i
    const LINKEDIN_RE = /linkedin/i

    const directHref = (() => {
      for (const a of Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href]'))) {
        const txt = (a.textContent?.trim() ?? '').replace(/[\s»›→»?⟩]+$/, '').trim()
        const href = a.href ?? ''
        if (!APPLY_RE.test(txt) || LINKEDIN_RE.test(txt)) continue
        if (!href || href.endsWith('#') || href.startsWith('javascript') || href === window.location.href) continue
        try {
          const path = new URL(href).pathname
          if (/apply|application|candidate|talentcommunity/i.test(path) || !isVisible(a)) return href
        } catch { /* invalid URL — skip */ }
      }
      return null
    })()

    if (directHref) {
      console.log(`[CS] Direct apply href — navigating: ${directHref}`)
      sendResponse({ clicked: true })
      setTimeout(() => { window.location.href = directHref }, 100)
    } else {
      const btn = [
        ...Array.from(document.querySelectorAll<HTMLElement>('button')).filter((el) => APPLY_RE.test(el.textContent ?? '') && isVisible(el)),
        ...Array.from(document.querySelectorAll<HTMLElement>('a[href]')).filter((el) => APPLY_RE.test(el.textContent ?? '') && isVisible(el)),
      ].find((el) => !text || el.textContent?.trim().toLowerCase().includes(text.toLowerCase()))

      if (btn) {
        sendResponse({ clicked: true })
        setTimeout(() => {
          btn.click()
          setTimeout(() => {
            const DROPDOWN_SEL = [
              '[role="menu"]', '[role="listbox"]', '[role="dialog"]',
              '.dropdown-menu', '.dropdown-content', '.popover',
              '[class*="dropdown"]', '[class*="Dropdown"]',
              '[class*="popup"]', '[class*="Popup"]',
              '[class*="menu"]', '[class*="Menu"]',
            ].join(',')

            let target: HTMLElement | null = null
            for (const container of Array.from(document.querySelectorAll<HTMLElement>(DROPDOWN_SEL))) {
              if (!isVisible(container)) continue
              const item = Array.from(
                container.querySelectorAll<HTMLElement>('a, button, li, [role="menuitem"], [role="option"]'),
              ).find(
                (el) => isVisible(el) && APPLY_RE.test(el.textContent ?? '') && !LINKEDIN_RE.test(el.textContent ?? '') && el !== btn,
              )
              if (item) { target = item; break }
            }

            if (!target) {
              target = [
                ...Array.from(document.querySelectorAll<HTMLElement>('a[href]'))
                  .filter((el) => isVisible(el) && APPLY_RE.test(el.textContent ?? '') && !LINKEDIN_RE.test(el.textContent ?? '') && el !== btn),
                ...Array.from(document.querySelectorAll<HTMLElement>('button'))
                  .filter((el) => isVisible(el) && APPLY_RE.test(el.textContent ?? '') && !LINKEDIN_RE.test(el.textContent ?? '') && el !== btn),
              ][0] ?? null
            }

            if (target) {
              const targetHref = (target as HTMLAnchorElement).href
              if (targetHref && !targetHref.endsWith('#') && !targetHref.startsWith('javascript')) {
                window.location.href = targetHref
              } else {
                target.click()
              }
            }
          }, 600)
        }, 100)
      } else {
        sendResponse({ clicked: false, error: 'Button not found' })
      }
    }
  }

  // Legacy fill without submit
  if (type === 'FILL_FORM') {
    const fills = (message.fills ?? []) as FillInstruction[]
    let filled = 0
    for (const instr of fills) {
      const el = resolveElement(instr)
      if (!el) continue
      const result = fillElement(el, instr.value)
      if (result === true) filled++
    }
    sendResponse({ filled })
  }

  return true
})
