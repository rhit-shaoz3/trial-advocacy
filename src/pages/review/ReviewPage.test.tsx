import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import { CourseServiceContext } from '../../courses/CourseServiceContext'
import type { CourseService, FactDecision, InterviewReview } from '../../courses/types'
import { fakeCourseService } from '../../test/fakeCourseService'
import { ReviewPage } from './ReviewPage'

const review: InterviewReview = {
  id: 'r1',
  caseId: 'k1',
  caseTitle: 'Rivera v. Thrill Park',
  witness: { id: 'w1', name: 'Elena Torres', role: 'Ride operator' },
  worldNumber: 2,
  teamNumber: 3,
  side: 'plaintiff',
  team: ['Ada Lawyer', 'Bo Partner'],
  status: 'open',
  error: null,
  createdAt: '2026-10-16T15:00:00.000Z',
  completedAt: null,
  facts: [
    { id: 'f1', text: 'Torres was on break at 3:00.', decision: null },
    { id: 'f2', text: 'Torres smelled smoke.', decision: null },
  ],
}

const ruled = (decisions: (FactDecision | null)[]) => ({
  ...review,
  facts: review.facts.map((f, i) => ({ ...f, decision: decisions[i] })),
})

function renderPage(overrides: Partial<CourseService>, url = '/courses/c1/review') {
  const service = fakeCourseService(overrides)
  const user = userEvent.setup()
  render(
    <MemoryRouter initialEntries={[url]}>
      <CourseServiceContext.Provider value={service}>
        <Routes>
          <Route path="courses/:courseId/review" element={<ReviewPage />} />
        </Routes>
      </CourseServiceContext.Provider>
    </MemoryRouter>,
  )
  return { user, service }
}

describe('ReviewPage', () => {
  it('shows each conversation to review with its world, team, and witness', async () => {
    const { service } = renderPage({ listReviews: vi.fn().mockResolvedValue([review]) })

    const card = await screen.findByRole('article', { name: 'Interview of Elena Torres' })
    expect(service.listReviews).toHaveBeenCalledWith('c1', 'open')
    expect(card).toHaveTextContent('Rivera v. Thrill Park')
    expect(card).toHaveTextContent('World B · Plaintiff · Team 3 (Ada Lawyer, Bo Partner)')
    expect(within(card).getAllByRole('radiogroup')).toHaveLength(2)
    expect(within(card).getByRole('button', { name: 'Finish review' })).toBeDisabled()
    expect(card).toHaveTextContent('0 of 2 ruled')
  })

  it('saves each ruling, and finishes the review once every fact has one', async () => {
    const decideFact = vi
      .fn()
      .mockResolvedValueOnce(ruled(['accept_world', null]))
      .mockResolvedValueOnce(ruled(['accept_world', 'deny_case']))
    const completeReview = vi.fn().mockResolvedValue({ ...ruled(['accept_world', 'deny_case']), status: 'completed' })
    const { user } = renderPage({ listReviews: vi.fn().mockResolvedValue([review]), decideFact, completeReview })

    const first = await screen.findByRole('radiogroup', { name: 'Ruling on fact 1' })
    expect(within(first).getAllByRole('radio').map((r) => r.closest('label')!.textContent)).toEqual([
      'Accept for this world',
      'Deny for this world',
      'Accept for all worlds',
      'Deny for all worlds',
    ])
    await user.click(within(first).getByRole('radio', { name: 'Accept for this world' }))
    expect(decideFact).toHaveBeenCalledWith('c1', 'r1', 'f1', 'accept_world')
    await user.click(within(screen.getByRole('radiogroup', { name: 'Ruling on fact 2' })).getByRole('radio', { name: 'Deny for all worlds' }))
    expect(decideFact).toHaveBeenLastCalledWith('c1', 'r1', 'f2', 'deny_case')

    await user.click(screen.getByRole('button', { name: 'Finish review' }))
    expect(completeReview).toHaveBeenCalledWith('c1', 'r1')
    expect(await screen.findByText('Nothing to review.')).toBeInTheDocument()
  })

  it('lists completed reviews with the rulings made', async () => {
    const done = { ...ruled(['accept_case', 'deny_world']), status: 'completed' as const, completedAt: '2026-10-16T16:00:00.000Z' }
    const listReviews = vi.fn().mockImplementation((_c: string, status: string) => Promise.resolve(status === 'completed' ? [done] : []))
    const { user } = renderPage({ listReviews })

    expect(await screen.findByText('Nothing to review.')).toBeInTheDocument()
    await user.click(screen.getByRole('tab', { name: 'Completed reviews' }))

    const card = await screen.findByRole('article', { name: 'Interview of Elena Torres' })
    expect(listReviews).toHaveBeenLastCalledWith('c1', 'completed')
    expect(card).toHaveTextContent('Accept for all worlds')
    expect(card).toHaveTextContent('Deny for this world')
    expect(within(card).queryByRole('radio')).not.toBeInTheDocument()
    expect(within(card).queryByRole('button', { name: 'Finish review' })).not.toBeInTheDocument()
  })

  it('shows a review still being summarized, and retries one that failed', async () => {
    const failed = { ...review, id: 'r2', status: 'failed' as const, error: 'Could not list the new facts.', facts: [] }
    const summarizing = { ...review, id: 'r3', status: 'summarizing' as const, facts: [] }
    const retryReview = vi.fn().mockResolvedValue({ ...failed, status: 'summarizing', error: null })
    const { user } = renderPage({ listReviews: vi.fn().mockResolvedValue([failed, summarizing]), retryReview })

    expect(await screen.findByText('Could not list the new facts.')).toBeInTheDocument()
    expect(screen.getByText('Listing the new facts in this conversation…')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    expect(retryReview).toHaveBeenCalledWith('c1', 'r2')
    expect(screen.getAllByText('Listing the new facts in this conversation…')).toHaveLength(2)
  })

  it('opens the conversation behind a review on request', async () => {
    const getReviewTranscript = vi
      .fn()
      .mockResolvedValue([{ question: 'Where were you at 3?', objection: 'Ms. Park: Objection, form.', answer: 'On break.', askedBy: 'Ada Lawyer' }])
    const { user } = renderPage({ listReviews: vi.fn().mockResolvedValue([review]), getReviewTranscript })

    await user.click(await screen.findByText('Show conversation'))
    expect(getReviewTranscript).toHaveBeenCalledWith('c1', 'r1')
    expect(await screen.findByText(/Where were you at 3\?/)).toBeInTheDocument()
    expect(screen.getByText('Ms. Park: Objection, form.')).toBeInTheDocument()
  })

  it("shows an investigator report with its assignment, and lets the instructor allow or refuse each file", async () => {
    const investigation: InterviewReview = {
      ...review,
      id: 'r5',
      kind: 'investigation',
      witness: null,
      assignment: 'Check the lift hill.',
      askedBy: 'Ada Lawyer',
      report: '1. I photographed the lift hill. [NEW FACT]',
      finalReport: null,
      recordsRequested: ["The park's maintenance records, by subpoena."],
      facts: [{ id: 'f1', text: 'A camera points at the lift hill.', decision: 'accept_world' }],
      documents: [{ materialId: 'm9', title: 'Inspection log', decision: null }],
    }
    const decideDocument = vi.fn().mockResolvedValue({ ...investigation, documents: [{ materialId: 'm9', title: 'Inspection log', decision: 'deny' }] })
    const completeReview = vi.fn().mockResolvedValue({ ...investigation, status: 'finalizing' })
    const { user } = renderPage({ listReviews: vi.fn().mockResolvedValue([investigation]), decideDocument, completeReview })

    const card = await screen.findByRole('article', { name: 'Investigation for Team 3' })
    expect(card).toHaveTextContent('Assignment from Ada Lawyer')
    expect(card).toHaveTextContent('Check the lift hill.')
    expect(card).toHaveTextContent('1. I photographed the lift hill.')
    expect(card).toHaveTextContent("The park's maintenance records, by subpoena.")
    expect(within(card).queryByText('Show conversation')).not.toBeInTheDocument()
    const finish = within(card).getByRole('button', { name: 'Finish review' })
    expect(finish).toBeDisabled()
    expect(card).toHaveTextContent('1 of 1 ruled · 0 of 1 files decided')

    const file = within(card).getByRole('radiogroup', { name: 'Allow Team 3 access to Inspection log' })
    await user.click(within(file).getByRole('radio', { name: "Don't allow" }))
    expect(decideDocument).toHaveBeenCalledWith('c1', 'r5', 'm9', 'deny')
    await user.click(within(card).getByRole('button', { name: 'Finish review' }))

    // It moves to Completed at once; the team's report is written there.
    expect(completeReview).toHaveBeenCalledWith('c1', 'r5')
    expect(screen.queryByRole('article', { name: 'Investigation for Team 3' })).not.toBeInTheDocument()
    expect(await screen.findByText('Nothing to review.')).toBeInTheDocument()
  })

  it('moves a finished review out at once, and brings it back if finishing fails', async () => {
    let fail!: (err: Error) => void
    const completeReview = vi.fn(() => new Promise<InterviewReview>((_, reject) => (fail = reject)))
    const { user } = renderPage({ listReviews: vi.fn().mockResolvedValue([{ ...review, facts: [] }]), completeReview })

    const card = await screen.findByRole('article', { name: 'Interview of Elena Torres' })
    await user.click(within(card).getByRole('button', { name: 'Finish review' }))
    // Gone before the server answers.
    expect(screen.queryByRole('article', { name: 'Interview of Elena Torres' })).not.toBeInTheDocument()

    fail(new Error('The server is down.'))
    expect(await screen.findByRole('article', { name: 'Interview of Elena Torres' })).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('Could not finish the review for Team 3. The server is down.')
  })

  it("warns when the investigator didn't list his new facts or files", async () => {
    const investigation: InterviewReview = {
      ...review,
      id: 'r6',
      kind: 'investigation',
      witness: null,
      assignment: 'Watch the park gate.',
      report: 'I watched the gate for an hour.',
      facts: [],
      documents: [],
      reviewBlockMissing: true,
    }
    renderPage({ listReviews: vi.fn().mockResolvedValue([investigation]) })

    const card = await screen.findByRole('article', { name: 'Investigation for Team 3' })
    expect(within(card).getByRole('note')).toHaveTextContent("The investigator didn’t list his new facts or files.")
    expect(within(card).getByRole('button', { name: 'Finish review' })).toBeEnabled()
  })
})
