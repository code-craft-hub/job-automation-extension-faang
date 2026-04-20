const OVERLAY_ID = 'codepilot-overlay'

export function injectOverlay(): void {
  if (document.getElementById(OVERLAY_ID)) return

  const overlay = document.createElement('div')
  overlay.id = OVERLAY_ID
  overlay.style.cssText = [
    'position: fixed',
    'bottom: 24px',
    'right: 24px',
    'z-index: 2147483647',
    'width: 48px',
    'height: 48px',
    'border-radius: 50%',
    'background: #00dc82',
    'display: flex',
    'align-items: center',
    'justify-content: center',
    'cursor: pointer',
    'box-shadow: 0 4px 16px rgba(0,220,130,0.4)',
    'transition: transform 0.15s ease, box-shadow 0.15s ease',
    'font-size: 22px',
    'user-select: none',
    'border: 2px solid rgba(255,255,255,0.2)',
  ].join(';')

  overlay.setAttribute('role', 'button')
  overlay.setAttribute('aria-label', 'Open CodePilot AI')
  overlay.setAttribute('tabindex', '0')
  overlay.textContent = '✦'

  overlay.addEventListener('mouseenter', () => {
    overlay.style.transform = 'scale(1.1)'
    overlay.style.boxShadow = '0 6px 20px rgba(0,220,130,0.6)'
  })
  overlay.addEventListener('mouseleave', () => {
    overlay.style.transform = 'scale(1)'
    overlay.style.boxShadow = '0 4px 16px rgba(0,220,130,0.4)'
  })
  overlay.addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'OPEN_SIDEPANEL' })
  })
  overlay.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      chrome.runtime.sendMessage({ type: 'OPEN_SIDEPANEL' })
    }
  })

  document.body.appendChild(overlay)
}

export function removeOverlay(): void {
  document.getElementById(OVERLAY_ID)?.remove()
}
