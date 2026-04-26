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
  status: 'filled' | 'failed' | 'not_found'
}

const JOB_LINK_RE =
  /\b(apply|application|job|career|position|opening|vacancy|hiring|recruit|join.?us|work.?with.?us|opportunities)\b/i

const FINAL_SUBMIT_RE =
  /\b(submit|send|finish|done|apply|submit application|send application|complete application|submit now|apply now)\b/i

const CONTINUE_RE =
  /\b(continue|next|next step|save and continue|save & continue|proceed|go to next)\b/i

// ── Helpers ────────────────────────────────────────────────────────────────────

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

function info(el: Element, extra: Partial<ElementInfo> = {}): ElementInfo {
  return {
    tag: el.tagName.toLowerCase(),
    type: el.getAttribute('type') ?? undefined,
    label: getLabel(el),
    name: el.getAttribute('name') ?? undefined,
    id: el.getAttribute('id') ?? undefined,
    required: el.hasAttribute('required') || el.getAttribute('aria-required') === 'true',
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

  // Fallback: any explicit type="submit" that isn't labeled as continue
  const explicit = candidates.find(
    (b) => b.getAttribute('type') === 'submit' && !CONTINUE_RE.test(b.textContent?.trim() ?? ''),
  )
  return explicit ? { btn: explicit, isFinal: true } : null
}

function fillElement(el: Element, value: string): boolean {
  const tag = el.tagName.toLowerCase()
  const type = el.getAttribute('type')?.toLowerCase()

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

  } else if (type === 'checkbox') {
    const cb = el as HTMLInputElement
    const shouldCheck = ['true', '1', 'yes', 'checked', 'on'].includes(value.toLowerCase())
    if (cb.checked !== shouldCheck) cb.click()

  } else if (type === 'radio') {
    const name = el.getAttribute('name')
    if (name) {
      try {
        const target = Array.from(
          document.querySelectorAll<HTMLInputElement>(`input[type="radio"][name="${CSS.escape(name)}"]`),
        ).find((r) => r.value.toLowerCase() === value.toLowerCase())
        if (!target) { console.warn(`[CS] No radio value="${value}" in group="${name}"`); return false }
        if (!target.checked) target.click()
      } catch { return false }
    }

  } else if (tag === 'textarea') {
    const ta = el as HTMLTextAreaElement
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
    setter?.call(ta, value)
    ta.dispatchEvent(new Event('input', { bubbles: true }))
    ta.dispatchEvent(new Event('change', { bubbles: true }))

  } else {
    const input = el as HTMLInputElement
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
    setter?.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new Event('change', { bubbles: true }))
  }

  return true
}

function resolveElement(instr: FillInstruction): Element | null {
  if (instr.name) {
    try {
      const el = document.querySelector(`[name="${CSS.escape(instr.name)}"]`)
      if (el) return el
    } catch { /* noop */ }
  }
  if (instr.id) return document.getElementById(instr.id)
  return null
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
    const fills = (message.fills ?? []) as FillInstruction[]
    console.log(`[CS] FILL_AND_SUBMIT: ${fills.length} instructions`)
    const report: FillReport[] = []
    let filledCount = 0

    for (const instr of fills) {
      const el = resolveElement(instr)
      const labelKey = instr.label ?? instr.name ?? instr.id ?? '?'

      if (!el) {
        console.warn(`[CS] Not found: ${labelKey}`)
        report.push({ label: labelKey, value: instr.value, source: instr.source ?? 'unknown', status: 'not_found' })
        continue
      }

      const ok = fillElement(el, instr.value)
      report.push({ label: labelKey, value: instr.value, source: instr.source ?? 'unknown', status: ok ? 'filled' : 'failed' })
      if (ok) {
        console.log(`[CS] ✓ "${labelKey}" = "${instr.value}" [${instr.source ?? '?'}]`)
        filledCount++
      } else {
        console.warn(`[CS] ✗ Failed: "${labelKey}"`)
      }
    }

    const action = findActionButton()
    const pageAction = action ? (action.isFinal ? 'submitted' : 'continued') : 'none'
    console.log(`[CS] Action button: ${action ? `<${action.btn.tagName.toLowerCase()}> "${action.btn.textContent?.trim()}" isFinal=${action.isFinal}` : 'not found'}`)

    // Send report BEFORE clicking — clicking may cause page navigation
    sendResponse({
      filled: filledCount,
      submitted: action?.isFinal ?? false,
      pageAction,
      report,
      url: window.location.href,
      title: document.title,
    })

    if (action) {
      setTimeout(() => {
        console.log(`[CS] Clicking ${action.isFinal ? 'submit' : 'continue'}...`)
        action.btn.click()
      }, 200)
    }
  }

  if (type === 'CLICK_BUTTON') {
    const text = (message.buttonText ?? '') as string
    const APPLY_RE = /\b(apply|apply now|apply for this job|start application|begin application)\b/i
    const LINKEDIN_RE = /linkedin/i

    // Strategy 1: many ATS sites embed the real apply href in the DOM before the dropdown
    // is toggled open (the link is just hidden by CSS). Navigate directly — no clicking needed.
    const directHref = (() => {
      for (const a of Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href]'))) {
        const txt = (a.textContent?.trim() ?? '').replace(/[\s»›→»?⟩]+$/, '').trim()
        const href = a.href ?? ''
        if (!APPLY_RE.test(txt) || LINKEDIN_RE.test(txt)) continue
        if (!href || href.endsWith('#') || href.startsWith('javascript') || href === window.location.href) continue
        try {
          const path = new URL(href).pathname
          // Only accept if the path contains apply/application/candidate keywords
          // OR the element is currently hidden (it's a dropdown-only link)
          if (/apply|application|candidate|talentcommunity/i.test(path) || !isVisible(a)) {
            return href
          }
        } catch { /* invalid URL — skip */ }
      }
      return null
    })()

    if (directHref) {
      console.log(`[CS] Direct apply href found — navigating: ${directHref}`)
      sendResponse({ clicked: true })
      setTimeout(() => { window.location.href = directHref }, 100)
    } else {
      // Strategy 2: click the visible toggle and auto-click the dropdown item after it opens
      const btn = [
        ...Array.from(document.querySelectorAll<HTMLElement>('button')).filter((el) => APPLY_RE.test(el.textContent ?? '') && isVisible(el)),
        ...Array.from(document.querySelectorAll<HTMLElement>('a[href]')).filter((el) => APPLY_RE.test(el.textContent ?? '') && isVisible(el)),
      ].find((el) => !text || el.textContent?.trim().toLowerCase().includes(text.toLowerCase()))

      if (btn) {
        sendResponse({ clicked: true })
        setTimeout(() => {
          btn.click()
          // After the click, detect if a dropdown opened and click the direct apply option
          setTimeout(() => {
            const DROPDOWN_SEL = [
              '[role="menu"]', '[role="listbox"]', '[role="dialog"]',
              '.dropdown-menu', '.dropdown-content', '.popover',
              '[class*="dropdown"]', '[class*="Dropdown"]',
              '[class*="popup"]', '[class*="Popup"]',
              '[class*="menu"]', '[class*="Menu"]',
            ].join(',')

            let target: HTMLElement | null = null

            // Search inside visible dropdown containers
            for (const container of Array.from(document.querySelectorAll<HTMLElement>(DROPDOWN_SEL))) {
              if (!isVisible(container)) continue
              const item = Array.from(
                container.querySelectorAll<HTMLElement>('a, button, li, [role="menuitem"], [role="option"]'),
              ).find(
                (el) => isVisible(el) && APPLY_RE.test(el.textContent ?? '') && !LINKEDIN_RE.test(el.textContent ?? '') && el !== btn,
              )
              if (item) { target = item; break }
            }

            // Fallback: any newly visible apply link/button (not the toggle, not LinkedIn)
            if (!target) {
              target = [
                ...Array.from(document.querySelectorAll<HTMLElement>('a[href]'))
                  .filter((el) => isVisible(el) && APPLY_RE.test(el.textContent ?? '') && !LINKEDIN_RE.test(el.textContent ?? '') && el !== btn),
                ...Array.from(document.querySelectorAll<HTMLElement>('button'))
                  .filter((el) => isVisible(el) && APPLY_RE.test(el.textContent ?? '') && !LINKEDIN_RE.test(el.textContent ?? '') && el !== btn),
              ][0] ?? null
            }

            if (target) {
              // Prefer navigating via href if target is a link, otherwise click
              const targetHref = (target as HTMLAnchorElement).href
              if (targetHref && !targetHref.endsWith('#') && !targetHref.startsWith('javascript')) {
                console.log(`[CS] Dropdown apply link — navigating: ${targetHref}`)
                window.location.href = targetHref
              } else {
                console.log(`[CS] Dropdown apply button — clicking: "${target.textContent?.trim()}"`)
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

  // Legacy fill without submit (kept for compatibility)
  if (type === 'FILL_FORM') {
    const fills = (message.fills ?? []) as FillInstruction[]
    let filled = 0
    for (const instr of fills) {
      const el = resolveElement(instr)
      if (!el) continue
      if (fillElement(el, instr.value)) filled++
    }
    sendResponse({ filled })
  }

  return true
})
