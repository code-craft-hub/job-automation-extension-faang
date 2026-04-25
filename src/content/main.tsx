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

type FillInstruction = { name?: string; id?: string; value: string }

const JOB_LINK_RE =
  /\b(apply|application|job|career|position|opening|vacancy|hiring|recruit|join.?us|work.?with.?us|opportunities)\b/i

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
    required:
      el.hasAttribute('required') || el.getAttribute('aria-required') === 'true',
    visible: isVisible(el),
    ...extra,
  }
}

function qAll(sel: string): Element[] {
  return Array.from(document.querySelectorAll(sel))
}

function fillElement(el: Element, value: string) {
  const tag = el.tagName.toLowerCase()
  const type = el.getAttribute('type')?.toLowerCase()

  if (tag === 'select') {
    const sel = el as HTMLSelectElement
    const option = Array.from(sel.options).find(
      (o) =>
        o.value.toLowerCase() === value.toLowerCase() ||
        o.text.toLowerCase().includes(value.toLowerCase()),
    )
    if (option) {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLSelectElement.prototype,
        'value',
      )?.set
      setter?.call(sel, option.value)
      sel.dispatchEvent(new Event('change', { bubbles: true }))
    }
  } else if (type === 'checkbox') {
    const cb = el as HTMLInputElement
    const shouldCheck = ['true', '1', 'yes', 'checked', 'on'].includes(
      value.toLowerCase(),
    )
    if (cb.checked !== shouldCheck) cb.click()
  } else if (type === 'radio') {
    const name = el.getAttribute('name')
    if (name) {
      try {
        const radios = document.querySelectorAll<HTMLInputElement>(
          `input[type="radio"][name="${CSS.escape(name)}"]`,
        )
        const target = Array.from(radios).find(
          (r) => r.value.toLowerCase() === value.toLowerCase(),
        )
        if (target && !target.checked) target.click()
      } catch { /* noop */ }
    }
  } else if (tag === 'textarea') {
    const ta = el as HTMLTextAreaElement
    const setter = Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      'value',
    )?.set
    setter?.call(ta, value)
    ta.dispatchEvent(new Event('input', { bubbles: true }))
    ta.dispatchEvent(new Event('change', { bubbles: true }))
  } else {
    // text, email, tel, number, url, date, etc.
    const input = el as HTMLInputElement
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value',
    )?.set
    setter?.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new Event('change', { bubbles: true }))
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'GET_JOB_ELEMENTS') {
    const TEXT_TYPES = ['text', 'email', 'tel', 'number', 'url', 'search', 'password']
    const textFields = qAll(
      [...TEXT_TYPES.map((t) => `input[type="${t}"]`), 'input:not([type])'].join(','),
    ).map((el) => info(el))

    const DATE_TYPES = ['date', 'datetime-local', 'month', 'week', 'time']
    const dateFields = qAll(DATE_TYPES.map((t) => `input[type="${t}"]`).join(',')).map(
      (el) => info(el),
    )

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
      const options = Array.from((el as HTMLSelectElement).options)
        .map((o) => o.text.trim())
        .filter(Boolean)
      return { ...info(el), options }
    })

    const textareas = qAll('textarea').map((el) => info(el))

    const BUTTON_SEL =
      'button,input[type="submit"],input[type="button"],input[type="reset"],input[type="image"]'
    const buttons = qAll(BUTTON_SEL).map((el) =>
      info(el, {
        value:
          ((el as HTMLInputElement).value?.trim() || el.textContent?.trim()) ?? undefined,
      }),
    )

    const navigationLinks = qAll('a[href]')
      .filter(
        (el) =>
          JOB_LINK_RE.test(el.textContent ?? '') ||
          JOB_LINK_RE.test((el as HTMLAnchorElement).href),
      )
      .map((el) =>
        info(el, {
          href: (el as HTMLAnchorElement).href,
          value: el.textContent?.trim() || undefined,
        }),
      )

    const richTextEditors = qAll('[contenteditable="true"]')
      .filter((el) => !['INPUT', 'SELECT', 'TEXTAREA'].includes(el.tagName))
      .map((el) => info(el))

    const ARIA_ROLES = [
      'textbox', 'combobox', 'listbox', 'spinbutton',
      'slider', 'switch', 'searchbox',
    ]
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
      dropdowns, textareas, buttons, navigationLinks,
      richTextEditors, customComponents, hiddenInputs,
    }

    const totals = Object.fromEntries(
      Object.entries(categories).map(([k, v]) => [k, v.length]),
    )

    sendResponse({ url: window.location.href, title: document.title, categories, totals })
  }

  if (message.type === 'FILL_FORM') {
    const fills = (message.fills ?? []) as FillInstruction[]
    let filled = 0

    for (const instr of fills) {
      let el: Element | null = null

      if (instr.name) {
        try {
          el = document.querySelector(`[name="${CSS.escape(instr.name)}"]`)
        } catch { /* noop */ }
      }
      if (!el && instr.id) {
        el = document.getElementById(instr.id)
      }

      if (!el) continue
      fillElement(el, instr.value)
      filled++
    }

    sendResponse({ filled })
  }

  return true
})
