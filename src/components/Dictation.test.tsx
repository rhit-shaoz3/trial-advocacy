import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DictationTextarea } from './Dictation'

/** A stand-in for the browser's speech recognition. */
class FakeRecognition {
  static last: FakeRecognition | null = null
  continuous = false
  interimResults = false
  lang = ''
  onresult: ((e: unknown) => void) | null = null
  onend: (() => void) | null = null
  onerror: (() => void) | null = null
  start = vi.fn(() => {
    FakeRecognition.last = this
  })
  stop = vi.fn(() => this.onend?.())
  say(transcript: string, isFinal = true) {
    this.onresult?.({ resultIndex: 0, results: [{ isFinal, 0: { transcript } }] })
  }
}

function Field() {
  const [value, setValue] = useState('Where were')
  return <DictationTextarea aria-label="Question" value={value} onChange={(e) => setValue(e.target.value)} />
}

afterEach(() => {
  vi.unstubAllGlobals()
  FakeRecognition.last = null
})

describe('DictationTextarea', () => {
  it('adds spoken words to what was typed, showing the phrase in progress', async () => {
    vi.stubGlobal('webkitSpeechRecognition', FakeRecognition)
    const user = userEvent.setup()
    render(<Field />)

    await user.click(screen.getByRole('button', { name: 'Dictate into Question' }))
    const mic = screen.getByRole('button', { name: 'Stop dictation' })
    expect(mic).toHaveAttribute('aria-pressed', 'true')
    expect(FakeRecognition.last!.continuous).toBe(true)

    act(() => FakeRecognition.last!.say('you standing', false))
    expect(screen.getByText('you standing')).toBeInTheDocument()
    act(() => FakeRecognition.last!.say('you standing?'))
    expect(screen.getByRole('textbox', { name: 'Question' })).toHaveValue('Where were you standing?')

    await user.click(mic)
    expect(screen.getByRole('button', { name: 'Dictate into Question' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('is a plain textarea where the browser has no dictation', () => {
    render(<Field />)
    expect(screen.getByRole('textbox', { name: 'Question' })).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })
})
