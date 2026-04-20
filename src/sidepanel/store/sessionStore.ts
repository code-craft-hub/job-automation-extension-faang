import { create } from 'zustand'
import type { Session } from '@/shared/types/session'

interface SessionState {
  sessions: Session[]
  currentSessionId: string | null
  setSessions: (s: Session[]) => void
  setCurrentSessionId: (id: string | null) => void
  upsertSession: (s: Session) => void
  removeSession: (id: string) => void
}

export const useSessionStore = create<SessionState>((set) => ({
  sessions: [],
  currentSessionId: null,
  setSessions: (sessions) => set({ sessions }),
  setCurrentSessionId: (currentSessionId) => set({ currentSessionId }),
  upsertSession: (session) =>
    set((state) => {
      const idx = state.sessions.findIndex((s) => s.id === session.id)
      if (idx === -1) return { sessions: [session, ...state.sessions] }
      const next = [...state.sessions]
      next[idx] = session
      return { sessions: next }
    }),
  removeSession: (id) =>
    set((state) => ({ sessions: state.sessions.filter((s) => s.id !== id) })),
}))
