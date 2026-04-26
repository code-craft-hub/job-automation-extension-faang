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
  /\b(submit|send|finish|done|apply|submit application|send application|complete application|submit now|apply now)\b/i

const CONTINUE_RE =
  /\b(continue|next|next step|save and continue|save & continue|proceed|go to next)\b/i

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

function findActionButton(): { btn: HTMLElement; isFinal: boolean } | null {
  const candidates = Array.from(
    document.querySelectorAll<HTMLElement>('button, input[type="submit"], input[type="button"]'),
  ).filter(isVisible)

  let finalBtn: HTMLElement | null = null
  let continueBtn: HTMLElement | null = null

  for (const btn of candidates) {
    const text = btn.textContent?.trim() || (btn as HTMLInputElement).value || ''
    if (!continueBtn && CONTINUE_RE.test(text)) continueBtn = btn
    if (!finalBtn && FINAL_SUBMIT_RE.test(text)) finalBtn = btn
  }

  if (finalBtn) return { btn: finalBtn, isFinal: true }
  if (continueBtn) return { btn: continueBtn, isFinal: false }

  const explicit = candidates.find(
    (b) => b.getAttribute('type') === 'submit' && !CONTINUE_RE.test(b.textContent?.trim() ?? ''),
  )
  return explicit ? { btn: explicit, isFinal: true } : null
}

// ── Custom dropdown detection ──────────────────────────────────────────────────

// Returns true when the element (or its close ancestor) is a custom React/JS dropdown,
// not a native <select>.  These need a click sequence to open + pick an option.
function isCustomDropdown(el: Element): boolean {
  const tag = el.tagName.toLowerCase()
  if (tag === 'select' || tag === 'textarea' || tag === 'button') return false

  // Non-input element with combobox/listbox role → definitely custom
  if (tag !== 'input') {
    const role = el.getAttribute('role')
    if (role === 'combobox' || role === 'listbox') return true
    if (el.hasAttribute('aria-haspopup')) return true
  }

  // Input that is read-only inside a styled container → custom select
  if (tag === 'input' && (el as HTMLInputElement).readOnly) {
    return !!(
      el.closest('[role="combobox"]') ||
      el.closest('[aria-haspopup]') ||
      el.closest('[class*="select"]') ||
      el.closest('[class*="Select"]') ||
      el.closest('[class*="dropdown"]') ||
      el.closest('[class*="Dropdown"]')
    )
  }

  return false
}

// Clicks a custom dropdown container, waits for options to render, clicks the match.
async function fillCustomDropdown(el: Element, value: string): Promise<boolean> {
  // Find the best trigger element (the visible clickable part of the dropdown)
  const container =
    el.closest('[role="combobox"]') ??
    el.closest('[aria-haspopup]') ??
    el.closest('[class*="select"]') ??
    el.closest('[class*="Select"]') ??
    el.parentElement ??
    el

  const trigger = (
    (container !== el && isVisible(container) ? container : null) ??
    el
  ) as HTMLElement

  // Open the dropdown
  trigger.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
  trigger.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
  trigger.click()
  trigger.dispatchEvent(new FocusEvent('focus', { bubbles: true }))

  await delay(450)

  const needle = value.toLowerCase().trim()
  const OPTION_SEL = [
    '[role="option"]',
    '[role="menuitem"]',
    '[class*="option"]',
    '[class*="Option"]',
    '[class*="item"]',
    'li',
  ].join(',')

  // 1. Search near the trigger first (less likely to hit a different open dropdown)
  const nearAncestor =
    trigger.closest('[role="listbox"]') ??
    trigger.parentElement?.querySelector('[role="listbox"]') ??
    trigger.parentElement?.parentElement?.querySelector('[role="listbox"]') ??
    trigger.parentElement

  if (nearAncestor) {
    for (const opt of Array.from(nearAncestor.querySelectorAll<HTMLElement>(OPTION_SEL))) {
      if (!isVisible(opt)) continue
      const txt = opt.textContent?.trim().toLowerCase() ?? ''
      const dataVal = (opt.getAttribute('data-value') ?? '').toLowerCase()
      if (txt === needle || txt.includes(needle) || dataVal === needle) {
        opt.click()
        console.log(`[CS] ✓ Custom dropdown (nearby): "${opt.textContent?.trim()}"`)
        await delay(150)
        return true
      }
    }
  }

  // 2. Global scan for any visible option matching the value
  for (const opt of Array.from(document.querySelectorAll<HTMLElement>(OPTION_SEL))) {
    if (!isVisible(opt)) continue
    const txt = opt.textContent?.trim().toLowerCase() ?? ''
    const dataVal = (opt.getAttribute('data-value') ?? '').toLowerCase()
    if (txt === needle || txt.includes(needle) || dataVal === needle) {
      opt.click()
      console.log(`[CS] ✓ Custom dropdown (global): "${opt.textContent?.trim()}"`)
      await delay(150)
      return true
    }
  }

  // Close the dropdown if nothing matched
  trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  console.warn(`[CS] Custom dropdown: no option matching "${value}"`)
  return false
}

// ── Phone field helpers ────────────────────────────────────────────────────────

// True when a phone text input is part of a split field (country selector + number).
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

// Strip leading country code (+1, +44, +234 …) from a phone string.
function stripCountryCode(phone: string): string {
  return phone
    .replace(/^\+\d{1,3}[-\s]?/, '')   // +XX or +XXX
    .replace(/^00\d{1,3}[-\s]?/, '')   // 00XX
    .trim()
}

// ── Fill element ───────────────────────────────────────────────────────────────

// Returns true on success, false on failure, 'custom' when async dropdown handling is needed.
function fillElement(el: Element, value: string): boolean | 'custom' {
  const tag = el.tagName.toLowerCase()
  const type = el.getAttribute('type')?.toLowerCase()

  // Custom dropdown — caller must use fillCustomDropdown() instead
  if (isCustomDropdown(el)) return 'custom'

  let filled = false

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

// ── Resolve element ────────────────────────────────────────────────────────────

function resolveElement(instr: FillInstruction): Element | null {
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
  // Label-text fallback
  if (instr.label) {
    const needle = instr.label.toLowerCase().replace(/[*\s]+/g, ' ').trim()
    for (const lbl of Array.from(document.querySelectorAll<HTMLElement>('label'))) {
      const t = (lbl.textContent ?? '').toLowerCase().replace(/[*\s]+/g, ' ').trim()
      if (!t || (!t.includes(needle) && !needle.includes(t))) continue
      const forId = lbl.getAttribute('for')
      if (forId) {
        const el = document.getElementById(forId)
        if (el) return el
      }
      const nested = lbl.querySelector('input, select, textarea, [role="combobox"]')
      if (nested) return nested
    }
    // Also try matching by placeholder or aria-label on inputs
    for (const el of qAll('input, select, textarea, [role="combobox"]')) {
      const lbl2 = getLabel(el).toLowerCase().replace(/[*\s]+/g, ' ').trim()
      if (lbl2 && (lbl2.includes(needle) || needle.includes(lbl2))) return el
    }
  }
  return null
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

  // Text / email / tel / textarea
  const TEXT_SEL = [
    'input[type="text"]', 'input[type="email"]', 'input[type="tel"]',
    'input[type="number"]', 'input[type="url"]', 'input:not([type])', 'textarea',
  ].join(',')
  for (const el of qAll(TEXT_SEL)) {
    if (!isVisible(el)) continue
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

  // Custom combobox / dropdown components (read-only inputs or role=combobox divs)
  for (const el of qAll('[role="combobox"], input[readonly]')) {
    if (!isVisible(el)) continue
    if (!isRequiredEl(el)) continue
    const val = (el as HTMLInputElement).value?.trim() ?? el.textContent?.trim() ?? ''
    if (!val || val.toLowerCase().startsWith('select')) {
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

  return result
}

// ── Message listener ───────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const type = message.type as string
  console.log(`[CS] Message: ${type}`)

  if (type === 'GET_JOB_ELEMENTS') {
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

    const richTextEditors = qAll('[contenteditable="true"]')
      .filter((el) => !['INPUT', 'SELECT', 'TEXTAREA'].includes(el.tagName))
      .map((el) => info(el))

    const ARIA_ROLES = ['textbox', 'combobox', 'listbox', 'spinbutton', 'slider', 'switch', 'searchbox']
    const customComponents = qAll(ARIA_ROLES.map((r) => `[role="${r}"]`).join(','))
      .filter((el) => !['INPUT', 'SELECT', 'TEXTAREA', 'BUTTON'].includes(el.tagName))
      .map((el) => info(el))

    const hiddenInputs: HiddenInput[] = qAll('input[type="hidden"]').map((el) => ({
      name: (el as HTMLInputElement).name || '',
      id: el.getAttribute('id') ?? undefined,
      value: (el as HTMLInputElement).value || undefined,
    }))

    const categories = {
      textFields, dateFields, fileUploads, checkboxes, radios,
      dropdowns, textareas, buttons, navigationLinks, applyButtons, richTextEditors,
      customComponents, hiddenInputs,
    }
    const totals = Object.fromEntries(Object.entries(categories).map(([k, v]) => [k, v.length]))

    console.log('[CS] Scan complete:', totals)
    sendResponse({
      url: window.location.href,
      title: document.title,
      pageText: getPageText(),
      categories,
      totals,
    })
  }

  if (type === 'FILL_AND_SUBMIT') {
    // Async handler — return true below keeps the channel open until sendResponse is called.
    ;(async () => {
      const fills = (message.fills ?? []) as FillInstruction[]
      const submitForm = message.submitForm !== false
      console.log(`[CS] FILL_AND_SUBMIT: ${fills.length} fills, submitForm=${submitForm}`)

      const report: FillReport[] = []
      let filledCount = 0
      const customQueue: { el: Element; value: string; label: string; source: string }[] = []

      // ── Sync fill pass ─────────────────────────────────────────────────────
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
          // Queue for async click-based fill
          customQueue.push({ el, value: instr.value, label: labelKey, source: instr.source ?? 'unknown' })
          report.push({ label: labelKey, value: instr.value, source: instr.source ?? 'unknown', status: 'async' })
          filledCount++ // optimistic; will be corrected below if it fails
        } else if (result) {
          console.log(`[CS] ✓ "${labelKey}" = "${instr.value}" [${instr.source ?? '?'}]`)
          report.push({ label: labelKey, value: instr.value, source: instr.source ?? 'unknown', status: 'filled' })
          filledCount++
        } else {
          console.warn(`[CS] ✗ Failed: "${labelKey}"`)
          report.push({ label: labelKey, value: instr.value, source: instr.source ?? 'unknown', status: 'failed' })
        }
      }

      // ── Async custom dropdown pass ──────────────────────────────────────────
      if (customQueue.length > 0) {
        console.log(`[CS] Async custom dropdown fills: ${customQueue.length}`)
        for (const item of customQueue) {
          const ok = await fillCustomDropdown(item.el, item.value)
          if (!ok) {
            // Mark as failed in the report
            const entry = report.find((r) => r.label === item.label && r.status === 'async')
            if (entry) { entry.status = 'failed'; filledCount-- }
          } else {
            const entry = report.find((r) => r.label === item.label && r.status === 'async')
            if (entry) entry.status = 'filled'
            console.log(`[CS] ✓ Custom dropdown "${item.label}" = "${item.value}"`)
          }
        }
        // Give React a moment to update state before scanning for unfilled fields
        await delay(300)
      }

      // ── Scan for still-unfilled required fields ────────────────────────────
      const unfilledRequired = getUnfilledRequired()
      if (unfilledRequired.length > 0) {
        console.log(`[CS] Unfilled required (${unfilledRequired.length}):`, unfilledRequired.map((f) => f.label))
      }

      const action = submitForm ? findActionButton() : null
      const pageAction = action ? (action.isFinal ? 'submitted' : 'continued') : 'none'
      if (submitForm) {
        console.log(`[CS] Action button: ${action ? `"${action.btn.textContent?.trim()}" isFinal=${action.isFinal}` : 'not found'}`)
      }

      // Send report BEFORE clicking — clicking may cause navigation
      sendResponse({
        filled: filledCount,
        submitted: action?.isFinal ?? false,
        pageAction,
        report,
        url: window.location.href,
        title: document.title,
        unfilledRequired,
      })

      if (action) {
        setTimeout(() => {
          console.log(`[CS] Clicking ${action.isFinal ? 'submit' : 'continue'}...`)
          action.btn.click()
        }, 200)
      }
    })()
  }

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
