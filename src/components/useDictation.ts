import { useCallback, useEffect, useRef, useState } from 'react'

// The browser's speech recognition (Chrome, Edge and Safari; not Firefox). It
// runs on the device or the browser's own service, so words appear as they're
// spoken with no round trip through our server.
interface RecognitionResult {
  isFinal: boolean
  0: { transcript: string }
}
interface RecognitionEvent {
  resultIndex: number
  results: ArrayLike<RecognitionResult>
}
interface Recognition {
  continuous: boolean
  interimResults: boolean
  lang: string
  onresult: ((e: RecognitionEvent) => void) | null
  onend: (() => void) | null
  onerror: (() => void) | null
  start(): void
  stop(): void
}
type RecognitionClass = new () => Recognition

function recognitionClass(): RecognitionClass | null {
  const w = window as unknown as { SpeechRecognition?: RecognitionClass; webkitSpeechRecognition?: RecognitionClass }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}

/** Whether this browser can take dictation. */
export const canDictate = () => typeof window !== 'undefined' && recognitionClass() !== null

/**
 * Dictation into a field: `start` listens until `stop` (or the browser stops
 * on its own), calling `onText` with each finished phrase; `interim` is the
 * phrase still being spoken.
 */
export function useDictation(onText: (text: string) => void) {
  const [listening, setListening] = useState(false)
  const [interim, setInterim] = useState('')
  const recognition = useRef<Recognition | null>(null)
  const onTextRef = useRef(onText)
  useEffect(() => {
    onTextRef.current = onText
  })

  const stop = useCallback(() => {
    recognition.current?.stop()
  }, [])

  const start = useCallback(() => {
    const Class = recognitionClass()
    if (!Class || recognition.current) return
    const r = new Class()
    r.continuous = true
    r.interimResults = true
    r.lang = navigator.language || 'en-US'
    r.onresult = (e) => {
      let pending = ''
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const result = e.results[i]
        if (result.isFinal) onTextRef.current(result[0].transcript.trim())
        else pending += result[0].transcript
      }
      setInterim(pending.trim())
    }
    r.onend = r.onerror = () => {
      recognition.current = null
      setListening(false)
      setInterim('')
    }
    recognition.current = r
    setListening(true)
    r.start()
  }, [])

  // Stop listening when the field goes away.
  useEffect(() => () => recognition.current?.stop(), [])

  return { listening, interim, start, stop }
}
