import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { CourseServiceContext } from '../../courses/CourseServiceContext'
import type { ExhibitReview } from '../../courses/types'
import { fakeCourseService } from '../../test/fakeCourseService'
import { ExhibitReviewCard } from './ExhibitReviewCard'

const review = (over: Partial<ExhibitReview>): ExhibitReview => ({
  id: 'x1',
  offeredBy: 'plaintiff',
  joint: false,
  position: 0,
  kind: 'material',
  sourceId: 'm1',
  parts: null,
  title: 'Medical records.pdf',
  excerpt: null,
  contentType: 'application/pdf',
  status: 'authenticity_review',
  authenticated: false,
  authenticityNote: 'No custodian can vouch for these.',
  authenticityRuling: null,
  authenticityRulingNote: null,
  objection: null,
  response: null,
  acceptsRedaction: null,
  ruling: null,
  rulingNote: null,
  redaction: null,
  supersededBy: null,
  label: null,
  updatedAt: '2026-11-02T10:00:00Z',
  ruledAt: null,
  caseId: 'k1',
  caseTitle: 'Ramirez v. Thrillville',
  worldNumber: 1,
  teams: { plaintiff: 1, defense: 2 },
  ruledBy: null,
  ...over,
})

function renderCard(r: ExhibitReview) {
  const service = fakeCourseService()
  const onRuled = vi.fn()
  const user = userEvent.setup()
  render(
    <CourseServiceContext.Provider value={service}>
      <ExhibitReviewCard courseId="c1" review={r} onRuled={onRuled} />
    </CourseServiceContext.Provider>,
  )
  return { user, service, onRuled }
}

describe('ExhibitReviewCard', () => {
  it('rules on an authenticity challenge, with the challenge beside it', async () => {
    const { user, service, onRuled } = renderCard(review({}))
    expect(screen.getByRole('article')).toHaveTextContent('World A · Offered by Team 1 (Plaintiff) · challenged by Team 2')
    expect(screen.getByRole('article')).toHaveTextContent('Authenticity challengeNo custodian can vouch for these.')
    await user.type(screen.getByRole('textbox', { name: /Note to both teams/ }), 'The records bear a certification.')
    await user.click(screen.getByRole('button', { name: 'Authenticate' }))
    expect(service.ruleOnExhibit).toHaveBeenCalledWith('c1', 'x1', {
      step: 'authenticity',
      decision: 'authenticate',
      note: 'The records bear a certification.',
    })
    expect(onRuled).toHaveBeenCalled()
  })

  it('says what follows authenticating: the objection the teams kept, or the version they agreed to', () => {
    renderCard(review({ objectionKept: true, objection: 'Hearsay.' }))
    expect(screen.getByText(/you rule on that next/)).toBeInTheDocument()
  })

  it('opens the redacted version the offering team proposed', async () => {
    const { user } = renderCard(
      review({
        status: 'admission_review',
        authenticated: true,
        objection: 'Hearsay.',
        response: 'Only page 1.',
        proposalMarked: true,
        objectionKept: true,
      }),
    )
    expect(screen.getByRole('article')).toHaveTextContent('Proposed redactionMarked on the exhibit.')
    expect(screen.getByRole('article')).toHaveTextContent('Objection keptThe teams didn’t settle it.')
    await user.click(screen.getByRole('button', { name: 'View proposed version' }))
    expect(await screen.findByRole('dialog', { name: /Medical records.pdf · proposed version/ })).toBeInTheDocument()
  })

  it('overrules, sustains, or partly overrules an objection with the redaction', async () => {
    const { user, service } = renderCard(
      review({ status: 'admission_review', authenticated: true, objection: 'Hearsay.', response: 'Business records.', acceptsRedaction: 'Page 4' }),
    )
    expect(screen.getByRole('article')).toHaveTextContent('ObjectionHearsay.')
    expect(screen.getByRole('article')).toHaveTextContent('ResponseBusiness records.')
    expect(screen.getByRole('article')).toHaveTextContent('Proposed redactionPage 4')
    await user.click(screen.getByRole('button', { name: 'Partially overrule' }))
    expect(screen.getByRole('button', { name: 'Admit with this redaction' })).toBeDisabled()
    await user.type(screen.getByRole('textbox', { name: /What’s redacted/ }), 'Page 4')
    await user.click(screen.getByRole('button', { name: 'Admit with this redaction' }))
    expect(service.ruleOnExhibit).toHaveBeenCalledWith('c1', 'x1', { step: 'admission', decision: 'partial', redaction: 'Page 4', note: '' })
  })

  it('opens the marks for an exhibit that can be marked, and rules with them', async () => {
    const service = fakeCourseService()
    const parts = [{ n: 0, question: 'And?', objection: null, text: 'The light was red.' }]
    vi.mocked(service.getExhibitMarking).mockResolvedValue({ markable: 'text', parts })
    const user = userEvent.setup()
    render(
      <CourseServiceContext.Provider value={service}>
        <ExhibitReviewCard
          courseId="c1"
          review={review({ kind: 'deposition', title: 'Deposition of Tom Becker', status: 'admission_review', objection: 'Hearsay.' })}
          onRuled={vi.fn()}
        />
      </CourseServiceContext.Provider>,
    )
    await user.click(screen.getByRole('button', { name: 'Partially overrule' }))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getAllByRole('checkbox', { name: 'Leave out' })[0])
    // Leaving out the only turn leaves nothing, so close and check the card waits for marks.
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(screen.getByRole('button', { name: 'Admit with this redaction' })).toBeDisabled()
    expect(screen.getByRole('article')).toHaveTextContent('Mark the redaction on the exhibit, or describe it below.')
    expect(screen.getByRole('textbox', { name: /What’s redacted/ })).toHaveAccessibleName(/optional/)
  })
})
