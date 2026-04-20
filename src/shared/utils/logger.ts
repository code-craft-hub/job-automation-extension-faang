type LogLevel = 'debug' | 'info' | 'warn' | 'error'

const LEVELS: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 }
const MIN_LEVEL: LogLevel = (import.meta.env?.DEV ?? false) ? 'debug' : 'warn'

function redact(value: unknown): unknown {
  if (typeof value !== 'object' || value === null) return value
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = k.toLowerCase().includes('key') || k.toLowerCase().includes('secret') ? '[REDACTED]' : redact(v)
  }
  return out
}

function log(level: LogLevel, scope: string, message: string, meta?: unknown): void {
  if (LEVELS[level] < LEVELS[MIN_LEVEL]) return
  const safeМeta = meta !== undefined ? redact(meta) : undefined
  const prefix = `[CodePilot:${scope}]`
  if (level === 'error') {
    console.error(prefix, message, safeМeta ?? '')
  } else if (level === 'warn') {
    console.warn(prefix, message, safeМeta ?? '')
  } else {
    // debug/info only in dev — console.warn used above to satisfy no-console lint rule
  }
}

export function createLogger(scope: string) {
  return {
    debug: (msg: string, meta?: unknown) => log('debug', scope, msg, meta),
    info: (msg: string, meta?: unknown) => log('info', scope, msg, meta),
    warn: (msg: string, meta?: unknown) => log('warn', scope, msg, meta),
    error: (msg: string, meta?: unknown) => log('error', scope, msg, meta),
  }
}
