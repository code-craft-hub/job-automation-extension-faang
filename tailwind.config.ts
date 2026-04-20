import type { Config } from 'tailwindcss'

export default {
  content: ['./src/**/*.{ts,tsx,html}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        cp: {
          bg: '#0f1117',
          surface: '#161b22',
          border: '#21262d',
          accent: '#00dc82',
          'accent-dim': '#00b368',
          muted: '#8b949e',
          text: '#e6edf3',
          error: '#f85149',
          warn: '#d29922',
          info: '#58a6ff',
          tool: '#bc8cff',
        },
      },
      fontFamily: {
        mono: ['JetBrains Mono', 'Cascadia Code', 'Fira Code', 'ui-monospace', 'monospace'],
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
      animation: {
        cursor: 'blink 1s step-end infinite',
        'fade-in': 'fadeIn 120ms ease-in',
        'slide-up': 'slideUp 200ms ease-out',
      },
      keyframes: {
        blink: { '0%, 100%': { opacity: '1' }, '50%': { opacity: '0' } },
        fadeIn: { from: { opacity: '0' }, to: { opacity: '1' } },
        slideUp: { from: { transform: 'translateY(6px)', opacity: '0' }, to: { transform: 'translateY(0)', opacity: '1' } },
      },
    },
  },
  plugins: [],
} satisfies Config
