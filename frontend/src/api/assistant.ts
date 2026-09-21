import apiClient from './client'
import { useAuthStore } from '@/stores/authStore'

export interface AssistantCitation {
  type: 'record' | 'knowledge' | 'document'
  label: string
  route?: string
  module?: string
}

/** A change the assistant prepared, waiting for the person to confirm. */
export interface AssistantActionCard {
  action_id: string
  action_type: string
  status: 'proposed' | 'executed' | 'cancelled' | 'expired' | 'failed'
  title: string
  lines: Array<{ label: string; value: string }>
  warnings?: string[]
  expires_at: string
  /** The site the change is in; its record opens inside that site. */
  facility_id?: number | null
  result?: { message: string; record?: string; route?: string; facility_id?: number } | null
  error?: string | null
}

const CONFIRM_WORDS = new Set([
  'yes', 'yes please', 'yeah', 'yep', 'yup', 'sure', 'confirm', 'confirm it', 'yes confirm', 'go ahead',
  'yes go ahead', 'ok go ahead', 'okay go ahead', 'do it', 'yes do it', 'ok do it', 'okay do it', 'please do',
  'proceed', 'go for it', 'ok confirm', 'okay confirm',
])
const CANCEL_WORDS = new Set([
  'no', 'nope', 'cancel', 'cancel it', 'no cancel', 'no thanks', 'dont', 'do not', 'never mind', 'nevermind',
  'dont do it', 'do not do it',
])

/**
 * "Yes" or "cancel" said to a change that is waiting, typed or spoken.
 *
 * Bare "ok" is deliberately not agreement: it is as often an acknowledgement,
 * and a change should never be made on one.
 */
export const decisionOf = (text: string): 'confirm' | 'cancel' | null => {
  const said = text.toLowerCase().replace(/[.,!?;:'"]/g, '').replace(/\s+/g, ' ').trim()
  if (CONFIRM_WORDS.has(said)) return 'confirm'
  if (CANCEL_WORDS.has(said)) return 'cancel'
  return null
}

/** A hospital document the assistant can quote. */
export interface KnowledgeDocument {
  doc_id: string
  title: string
  filename?: string | null
  facility_id: number | null
  site: string
  sections?: number | null
  passages: number
  uploaded_by?: string | null
  uploaded_at?: string | null
}

export const fetchKnowledgeDocuments = async (
  facilityId?: number | null,
): Promise<{ items: KnowledgeDocument[] }> => {
  const res = await apiClient.get('/assistant/knowledge/documents', {
    params: facilityId ? { facility_id: facilityId } : {},
  })
  return res.data
}

export const uploadKnowledgeDocument = async (
  file: File,
  options: { title?: string; facilityId?: number | null },
): Promise<KnowledgeDocument> => {
  const form = new FormData()
  form.append('file', file, file.name)
  const params: Record<string, string | number> = {}
  if (options.title) params.title = options.title
  if (options.facilityId) params.facility_id = options.facilityId
  // The shared client defaults to JSON, which stops axios writing the
  // multipart boundary; every upload in this codebase overrides it.
  const res = await apiClient.post('/assistant/knowledge/documents', form, {
    params, headers: { 'Content-Type': 'multipart/form-data' },
  })
  return res.data
}

export const deleteKnowledgeDocument = async (docId: string): Promise<void> => {
  await apiClient.delete(`/assistant/knowledge/documents/${docId}`)
}

export const confirmAssistantAction = async (id: string): Promise<AssistantActionCard> => {
  const res = await apiClient.post(`/assistant/actions/${id}/confirm`)
  return res.data
}

export const cancelAssistantAction = async (id: string): Promise<AssistantActionCard> => {
  const res = await apiClient.post(`/assistant/actions/${id}/cancel`)
  return res.data
}

export interface AssistantAnswer {
  answer: string
  citations: AssistantCitation[]
  /** Prepared this turn; each needs the person to press Confirm. */
  actions?: AssistantActionCard[]
  intent?: string
  module?: string
  tools_used?: string[]
  errors?: string[]
  /** Wall time per graph node, in milliseconds, including "total". */
  timings?: Record<string, number>
}

export interface AssistantStatus {
  enabled: boolean
  available_to_user: boolean
  voice_enabled?: boolean
}

/** Synthesize speech for an answer. Returns playable WAV audio. */
export const synthesizeSpeech = async (text: string): Promise<Blob> => {
  const res = await apiClient.post(
    '/assistant/speech/tts',
    { text },
    { responseType: 'blob' },
  )
  return res.data as Blob
}

/** Transcribe a recorded question. The recording is never stored server-side. */
export const transcribeSpeech = async (audio: Blob): Promise<string> => {
  const form = new FormData()
  form.append('audio', audio, 'question.webm')
  // The shared client defaults every request to application/json, which stops
  // axios generating the multipart boundary and leaves the server unable to
  // parse the upload. Every other upload in this codebase overrides it the
  // same way.
  const res = await apiClient.post('/assistant/speech/stt', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
  })
  return (res.data?.text || '').trim()
}

/**
 * WebSocket URL for the live microphone stream.
 *
 * A browser cannot set an Authorization header on a WebSocket, so the token
 * goes in the path, exactly as the existing chat socket does.
 */
export const voiceStreamUrl = (): string => {
  const token = useAuthStore.getState().token || ''
  const base = (apiClient.defaults.baseURL || '').replace(/\/$/, '')
  const absolute = base.startsWith('http')
    ? base
    : `${window.location.origin}${base}`
  // Under /ws/ because that is the path the production proxy upgrades.
  return `${absolute.replace(/^http/, 'ws')}/ws/assistant-voice/${encodeURIComponent(token)}`
}

/**
 * WebSocket URL for a live spoken conversation.
 *
 * Under /ws/ because that is the only path the production proxy upgrades, and
 * the token travels in it because a browser cannot set headers on a WebSocket.
 */
export const liveVoiceUrl = (): string => {
  const token = useAuthStore.getState().token || ''
  const base = (apiClient.defaults.baseURL || '').replace(/\/$/, '')
  const absolute = base.startsWith('http') ? base : `${window.location.origin}${base}`
  return `${absolute.replace(/^http/, 'ws')}/ws/assistant-live/${encodeURIComponent(token)}`
}

export const fetchAssistantStatus = async (): Promise<AssistantStatus> => {
  const res = await apiClient.get('/assistant/status')
  return res.data
}

type StreamHandlers = {
  onProgress?: (node: string) => void
  /** Fired for each token as the model produces it. */
  onToken?: (text: string) => void
  /** A prepared action, sent as soon as it exists rather than with the answer. */
  onAction?: (card: AssistantActionCard) => void
  onAnswer: (answer: AssistantAnswer) => void
  onError: (message: string) => void
}

/**
 * Ask the assistant, consuming the Server-Sent Event stream.
 *
 * EventSource cannot issue a POST or send an Authorization header, so the
 * stream is read directly from fetch. The returned function aborts the run.
 */
export interface ConversationTurn {
  role: 'user' | 'assistant'
  text: string
}

export const askAssistant = (
  question: string,
  handlers: StreamHandlers,
  history: ConversationTurn[] = [],
  /** Answer will be spoken, so the agent writes it to be heard, not read. */
  voice = false,
  /** The site the question is asked from; answers default to it. */
  facilityId?: number | null,
): (() => void) => {
  const controller = new AbortController()
  const token = useAuthStore.getState().token
  const base = (apiClient.defaults.baseURL || '').replace(/\/$/, '')

  const run = async () => {
    try {
      const response = await fetch(`${base}/assistant/ask`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ question, history, voice, facility_id: facilityId ?? null }),
        signal: controller.signal,
      })

      if (!response.ok || !response.body) {
        // What the server said stays in the network log. The person is told,
        // in the screens' words, what they can do about it.
        handlers.onError(
          response.status === 403
            ? 'The assistant is available to Super Admin accounts only.'
            : response.status === 401
              ? 'Your session has ended. Sign in again to keep using the assistant.'
              : response.status === 429
                ? 'The assistant is busy. Please try again in a moment.'
                : 'The assistant is not responding right now. Please try again in a moment.',
        )
        return
      }

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })

        // SSE frames are separated by a blank line.
        let split = buffer.indexOf('\n\n')
        while (split !== -1) {
          handleFrame(buffer.slice(0, split), handlers)
          buffer = buffer.slice(split + 2)
          split = buffer.indexOf('\n\n')
        }
      }
    } catch (error) {
      if ((error as Error).name === 'AbortError') return
      handlers.onError('Lost connection to the assistant.')
    }
  }

  void run()
  return () => controller.abort()
}

const handleFrame = (frame: string, handlers: StreamHandlers) => {
  let event = 'message'
  const dataLines: string[] = []
  for (const line of frame.split('\n')) {
    if (line.startsWith('event:')) event = line.slice(6).trim()
    else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim())
  }
  if (!dataLines.length) return

  let payload: any
  try {
    payload = JSON.parse(dataLines.join('\n'))
  } catch {
    return
  }

  if (event === 'error') handlers.onError(payload.error || 'The assistant failed.')
  else if (event === 'progress') handlers.onProgress?.(payload.node)
  else if (event === 'token') handlers.onToken?.(payload.text || '')
  else if (event === 'action') handlers.onAction?.(payload.card as AssistantActionCard)
  else if (event === 'answer') handlers.onAnswer(payload as AssistantAnswer)
}
