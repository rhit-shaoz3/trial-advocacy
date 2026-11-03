import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { CourseServiceContext } from '../../../courses/CourseServiceContext'
import type { ExhibitReview } from '../../../courses/types'
import { fakeCourseService } from '../../../test/fakeCourseService'
import { RedactionEditor } from './RedactionEditor'

const exhibit = {
  id: 'x1',
  kind: 'deposition',
  title: 'Deposition of Tom Becker (Oct 1)',
} as ExhibitReview

const parts = [
  { n: 0, question: 'What did you see?', objection: null, text: 'The light was red.' },
  { n: 1, question: 'Then?', objection: null, text: 'I sent it anyway.' },
]

function renderEditor() {
  const onSave = vi.fn()
  const user = userEvent.setup()
  render(
    <CourseServiceContext.Provider value={fakeCourseService()}>
      <RedactionEditor courseId="c1" exhibit={exhibit} marking={{ markable: 'text', parts }} onSave={onSave} onClose={vi.fn()} />
    </CourseServiceContext.Provider>,
  )
  return { user, onSave }
}

/** Selects `text` within the answer that contains it, as a mouse would. */
function select(text: string) {
  const field = [...document.querySelectorAll<HTMLElement>('[data-field="text"]')].find((el) => el.textContent!.includes(text))!
  const node = field.firstChild!
  const start = node.textContent!.indexOf(text)
  const range = document.createRange()
  range.setStart(node, start)
  range.setEnd(node, start + text.length)
  window.getSelection()!.removeAllRanges()
  window.getSelection()!.addRange(range)
  fireEvent.mouseUp(field)
}

describe('RedactionEditor', () => {
  it('marks selected text as redacted, previews the black-out, and saves the marks', async () => {
    const { user, onSave } = renderEditor()
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByRole('button', { name: 'Use these marks' })).toBeDisabled()
    expect(dialog).toHaveTextContent('Mark what’s redacted or what’s admitted.')

    select('light')
    await user.click(within(dialog).getByRole('button', { name: 'Mark' }))
    expect(within(dialog).getByText('light', { selector: 'mark' })).toBeInTheDocument()
    expect(dialog).toHaveTextContent('Admits 2 of 2 turns')

    await user.click(within(dialog).getByRole('checkbox', { name: 'Show what’s admitted' }))
    expect(dialog).toHaveTextContent('The █████ was red.')

    await user.click(within(dialog).getByRole('button', { name: 'Use these marks' }))
    expect(onSave).toHaveBeenCalledWith({
      marks: { mode: 'redact', parts: [{ n: 0, removed: false, ranges: [{ field: 'text', start: 4, end: 9 }] }] },
      summary: 'Admits 2 of 2 turns',
    })
  })

  it('marking what’s admitted leaves out the parts with nothing marked', async () => {
    const { user, onSave } = renderEditor()
    const dialog = screen.getByRole('dialog')
    await user.click(within(dialog).getByRole('radio', { name: 'Mark what’s admitted' }))
    select('I sent it')
    await user.click(within(dialog).getByRole('button', { name: 'Mark' }))
    expect(dialog).toHaveTextContent('Left out: nothing marked admitted')
    expect(dialog).toHaveTextContent('Admits 1 of 2 turns')

    // Leaving out the only marked turn leaves nothing to admit.
    await user.click(within(dialog).getAllByRole('checkbox', { name: 'Leave out' })[1])
    expect(dialog).toHaveTextContent('Nothing is left to admit.')
    expect(within(dialog).getByRole('button', { name: 'Use these marks' })).toBeDisabled()
    await user.click(within(dialog).getAllByRole('checkbox', { name: 'Leave out' })[1])

    await user.click(within(dialog).getByRole('button', { name: 'Use these marks' }))
    expect(onSave.mock.calls[0][0].marks).toEqual({
      mode: 'admit',
      parts: [{ n: 1, removed: false, ranges: [{ field: 'text', start: 0, end: 9 }] }],
    })
  })

  it('takes a mark off when it’s clicked', async () => {
    const { user } = renderEditor()
    const dialog = screen.getByRole('dialog')
    select('red')
    await user.click(within(dialog).getByRole('button', { name: 'Mark' }))
    await user.click(within(dialog).getByText('red', { selector: 'mark' }))
    expect(within(dialog).queryByText('red', { selector: 'mark' })).not.toBeInTheDocument()
  })
})
