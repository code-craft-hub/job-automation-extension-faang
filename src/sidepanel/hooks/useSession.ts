import { useCallback, useEffect } from 'react'
import { useSessionStore } from '../store/sessionStore'
import { useChatStore } from '../store/chatStore'
import type { Session } from '@/shared/types/session'

export function useSession() {
  const { sessions, currentSessionId, setSessions, setCurrentSessionId, upsertSession, removeSession } =
    useSessionStore()
  const { setMessages, reset } = useChatStore()

  // On mount: load sessions, auto-select the most recent, or create one if none exist
  useEffect(() => {
    chrome.runtime.sendMessage({ type: 'SESSION_LIST' }, (list: Session[]) => {
      if (chrome.runtime.lastError) return
      const loaded = list ?? []
      setSessions(loaded)
      if (loaded.length > 0) {
        const latest = loaded[0]!
        setCurrentSessionId(latest.id)
        setMessages(latest.messages)
      } else {
        // No sessions yet — eagerly create one so the first send never waits
        chrome.runtime.sendMessage({ type: 'SESSION_CREATE' }, (session: Session) => {
          if (chrome.runtime.lastError || !session) return
          upsertSession(session)
          setCurrentSessionId(session.id)
        })
      }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const loadSessions = useCallback(() => {
    chrome.runtime.sendMessage({ type: 'SESSION_LIST' }, (list: Session[]) => {
      if (chrome.runtime.lastError) return
      setSessions(list ?? [])
    })
  }, [setSessions])

  // Returns the new session's ID so callers can await it
  const createSession = useCallback((): Promise<string> => {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: 'SESSION_CREATE' }, (session: Session) => {
        if (chrome.runtime.lastError || !session) {
          resolve('')
          return
        }
        upsertSession(session)
        setCurrentSessionId(session.id)
        reset()
        resolve(session.id)
      })
    })
  }, [upsertSession, setCurrentSessionId, reset])

  const switchSession = useCallback(
    (id: string) => {
      const session = sessions.find((s) => s.id === id)
      if (!session) return
      setCurrentSessionId(id)
      setMessages(session.messages)
    },
    [sessions, setCurrentSessionId, setMessages]
  )

  const deleteSession = useCallback(
    (id: string) => {
      chrome.runtime.sendMessage({ type: 'SESSION_DELETE', id }, () => {
        removeSession(id)
        if (currentSessionId === id) {
          setCurrentSessionId(null)
          reset()
        }
      })
    },
    [currentSessionId, removeSession, setCurrentSessionId, reset]
  )

  const refreshCurrentSession = useCallback(
    (sessionId: string) => {
      chrome.runtime.sendMessage({ type: 'SESSION_GET', id: sessionId }, (session: Session | null) => {
        if (session) {
          upsertSession(session)
          if (sessionId === currentSessionId) {
            setMessages(session.messages)
          }
        }
      })
    },
    [currentSessionId, upsertSession, setMessages]
  )

  return {
    sessions,
    currentSessionId,
    createSession,
    switchSession,
    deleteSession,
    refreshCurrentSession,
    loadSessions,
  }
}
