import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { CourseServiceContext } from '../../courses/CourseServiceContext'
import type { ExhibitReview } from '../../courses/types'
import { fakeCourseService } from '../../test/fakeCourseService'
import { ExhibitPairCard } from './ExhibitPairCard'

const version = (over: Partial<ExhibitReview>): ExhibitReview => ({
  id: 'p1',
  offeredBy: 'plaintiff',
  joint: false,
  position: 0,
  kind: 'material',
  sourceId: 'm1',
  parts: [1, 2],
  title: 'Notes.docx — paragraphs 1–2',
  sourceTitle: 'Notes.docx',
  excerpt: null,
  contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  status: 'admission_review',
  authenticated: true,
  authenticityNote: null,
  authenticityRuling: null,
  authenticityRulingNote: null,
  objection: 'Hearsay.',
  response: 'Business records.',
  acceptsRedaction: null,
  ruling: null,
  rulingNote: null,
  redaction: null,
  supersededBy: null,
  label: null,
  updatedAt: '2026-11-03T10:00:00Z',
  ruledAt: null,
  caseId: 'k1',
  caseTitle: 'Winston v. Thrillville',
  worldNumber: 1,
  teams: { plaintiff: 1, defense: 2 },
  ruledBy: null,
  ...over,
})

const plaintiff = version({ pairedWith: 'd1' })
const defense = version({ id: 'd1', offeredBy: 'defense', parts: [1, 2, 3], title: 'Notes.docx — paragraphs 2–3', pairedWith: 'p1' })

function renderCard() {
  const service = fakeCourseService()
  const onRuled = vi.fn()
  const user = userEvent.setup()
  render(
    <CourseServiceContext.Provider value={service}>
      <ExhibitPairCard courseId="c1" versions={[plaintiff, defense]} onRuled={onRuled} />
    </CourseServiceContext.Provider>,
  )
  return { user, service, onRuled }
}

describe('ExhibitPairCard', () => {
  it('shows both versions together, and rules on them with one choice', async () => {
    const { user, service, onRuled } = renderCard()
    const card = screen.getByRole('article', { name: 'Notes.docx' })
    expect(within(card).getByRole('region', { name: 'Version 1' })).toHaveTextContent('Version 1 · Plaintiff’s (Team 1)paragraphs 1–2')
    expect(within(card).getByRole('region', { name: 'Version 2' })).toHaveTextContent('Version 2 · Defense’s (Team 2)paragraphs 2–3')
    const choices = within(card).getByRole('group', { name: 'Your ruling' })
    expect(within(choices).getAllByRole('radio').map((r) => r.parentElement!.textContent)).toEqual([
      'Admit the whole document',
      'Admit version 1: the plaintiff’s (paragraphs 1–2)',
      'Admit version 2: the defense’s (paragraphs 2–3)',
      'Admit part of it: mark it on the original',
      'Keep it out entirely',
    ])
    expect(within(card).getByRole('button', { name: 'Rule' })).toBeDisabled()
    await user.click(within(choices).getByRole('radio', { name: /Admit version 2/ }))
    await user.type(within(card).getByRole('textbox', { name: /Note to both teams/ }), 'Completeness.')
    await user.click(within(card).getByRole('button', { name: 'Rule' }))
    expect(service.ruleOnExhibitVersions).toHaveBeenCalledWith('c1', ['p1', 'd1'], { decision: 'defense', note: 'Completeness.' })
    expect(onRuled).toHaveBeenCalled()
  })

  it('compares text versions, highlighting what only one has', async () => {
    const { user, service } = renderCard()
    const para = (n: number, text: string) => ({ n, text })
    vi.mocked(service.getExhibitMarking).mockImplementation(async (_c, id) => ({
      markable: 'text',
      parts: id === 'p1' ? [para(0, 'Rider was calm.'), para(1, 'Light was red.')] : [para(1, 'Light was red.'), para(2, 'Sent anyway.')],
    }))
    await user.click(screen.getByRole('button', { name: 'Compare side by side' }))
    const dialog = await screen.findByRole('dialog', { name: 'Notes.docx' })
    const rows = await within(dialog).findAllByRole('listitem')
    expect(rows.map((r) => [r.className, r.textContent])).toEqual([
      ['xl-only-1', '¶1, only in version 1 Rider was calm.'],
      ['', '¶2 Light was red.'],
      ['xl-only-2', '¶3, only in version 2 Sent anyway.'],
    ])
  })

  it('offers no separate choice for a version that is the whole document', () => {
    const service = fakeCourseService()
    render(
      <CourseServiceContext.Provider value={service}>
        <ExhibitPairCard courseId="c1" versions={[version({ parts: null, title: 'Notes.docx' }), defense]} onRuled={vi.fn()} />
      </CourseServiceContext.Provider>,
    )
    expect(screen.queryByRole('radio', { name: /Admit version 1/ })).not.toBeInTheDocument()
    expect(screen.getByRole('radio', { name: /Admit version 2/ })).toBeInTheDocument()
  })
})
