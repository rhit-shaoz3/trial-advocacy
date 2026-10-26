import { forwardRef, useEffect, useImperativeHandle, useRef, useState, type TextareaHTMLAttributes } from 'react'
import { Mic } from 'lucide-react'
import { canDictate, useDictation } from './useDictation'
import './Dictation.css'

/** Sets a field's value the way typing would, so React's onChange runs as usual. */
function typeInto(field: HTMLTextAreaElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!
  setter.call(field, value)
  field.dispatchEvent(new Event('input', { bubbles: true }))
}

/**
 * A textarea with a microphone button for speaking instead of typing. Use it
 * exactly like a textarea. The button only appears where the browser supports
 * dictation; spoken phrases are added to the end of what's there.
 */
export const DictationTextarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function DictationTextarea({ className, ...props }, ref) {
    const field = useRef<HTMLTextAreaElement>(null)
    useImperativeHandle(ref, () => field.current!)
    const [supported] = useState(canDictate)
    const { listening, interim, start, stop } = useDictation((text) => {
      const el = field.current
      if (!el || !text) return
      const joined = el.value && !/\s$/.test(el.value) ? `${el.value} ${text}` : `${el.value}${text}`
      typeInto(el, props.maxLength ? joined.slice(0, props.maxLength) : joined)
    })

    // Sending the form ends dictation.
    useEffect(() => {
      const form = field.current?.form
      if (!form || !listening) return
      form.addEventListener('submit', stop)
      return () => form.removeEventListener('submit', stop)
    }, [listening, stop])

    useEffect(() => {
      if (props.disabled && listening) stop()
    }, [props.disabled, listening, stop])

    if (!supported) return <textarea ref={field} className={className} {...props} />

    const label = typeof props['aria-label'] === 'string' ? props['aria-label'] : 'this field'
    return (
      <span className="dictate-field">
        <textarea ref={field} className={className ? `${className} dictate-input` : 'dictate-input'} {...props} />
        <button
          type="button"
          className={listening ? 'dictate-button dictate-listening' : 'dictate-button'}
          aria-pressed={listening}
          aria-label={listening ? 'Stop dictation' : `Dictate into ${label}`}
          title={listening ? 'Stop dictation' : 'Speak instead of typing'}
          disabled={props.disabled}
          onClick={() => (listening ? stop() : start())}
        >
          <Mic aria-hidden="true" />
        </button>
        {listening && (
          <span className="dictate-interim" aria-live="polite">
            {interim || 'Listening…'}
          </span>
        )}
      </span>
    )
  },
)
