import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import { CourseServiceContext } from '../../courses/CourseServiceContext'
import type {
  CaseFacts,
  CourseCase,
  CourseFlag,
  CourseService,
  CourseSubpoena,
  FactDecision,
  FactGroup,
  InterviewReview,
  ReviewQueue,
} from '../../courses/types'
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

const facts: CaseFacts = {
  fileFacts: { status: 'ready', facts: [] },
  important: { plaintiff: [], defense: [] },
  allWorlds: { accepted: [], denied: [] },
  worlds: [],
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

/** The open queue: these reviews, and any groups or flags. */
const queue = (reviews: InterviewReview[], more: Partial<ReviewQueue> = {}) =>
  vi.fn().mockResolvedValue({ reviews, groups: [], flags: [], ...more })

describe('ReviewPage', () => {
  it('shows each conversation to review with its world, team, and witness', async () => {
    const { service } = renderPage({ listReviewQueue: queue([review]) })

    const card = await screen.findByRole('article', { name: 'Interview of Elena Torres' })
    expect(service.listReviewQueue).toHaveBeenCalledWith('c1')
    expect(card).toHaveTextContent('Rivera v. Thrill Park')
    expect(card).toHaveTextContent('World B · Plaintiff · Team 3 (Ada Lawyer, Bo Partner)')
    expect(within(card).getAllByRole('radiogroup')).toHaveLength(2)
    expect(within(card).queryByRole('button', { name: 'Finish review' })).not.toBeInTheDocument()
    expect(card).toHaveTextContent('0 of 2 ruled')
  })

  it('saves each ruling, and the review is done once every fact has one', async () => {
    const decideFact = vi
      .fn()
      .mockResolvedValueOnce(ruled(['accept_world', null]))
      .mockResolvedValueOnce({ ...ruled(['accept_world', 'deny_case']), status: 'completed' })
    const { user } = renderPage({ listReviewQueue: queue([review]), decideFact })

    const first = await screen.findByRole('radiogroup', { name: 'Ruling on fact 1' })
    expect(within(first).getAllByRole('radio').map((r) => r.closest('label')!.textContent)).toEqual([
      'Accept for this world',
      'Deny for this world',
      'Accept for all worlds',
      'Deny for all worlds',
    ])
    await user.click(within(first).getByRole('radio', { name: 'Accept for this world' }))
    expect(decideFact).toHaveBeenCalledWith('c1', 'r1', 'f1', 'accept_world')
    expect(screen.getByRole('article', { name: 'Interview of Elena Torres' })).toHaveTextContent('1 of 2 ruled')
    await user.click(within(screen.getByRole('radiogroup', { name: 'Ruling on fact 2' })).getByRole('radio', { name: 'Deny for all worlds' }))
    expect(decideFact).toHaveBeenLastCalledWith('c1', 'r1', 'f2', 'deny_case')

    expect(await screen.findByRole('status')).toHaveTextContent('Interview of Elena Torres for Team 3 is done.')
    expect(screen.queryByRole('article', { name: 'Interview of Elena Torres' })).not.toBeInTheDocument()
  })

  it('lists completed reviews with the rulings made, which can still be changed', async () => {
    const done = { ...ruled(['accept_case', 'deny_world']), status: 'completed' as const, completedAt: '2026-10-16T16:00:00.000Z' }
    const listReviews = vi.fn().mockResolvedValue([done])
    const decideFact = vi.fn().mockResolvedValue({ ...done, facts: [{ ...done.facts[0], decision: 'deny_case' }, done.facts[1]] })
    const { user } = renderPage({ listReviews, decideFact })

    expect(await screen.findByText('Nothing to review.')).toBeInTheDocument()
    await user.click(screen.getByRole('tab', { name: 'Completed reviews' }))

    const card = await screen.findByRole('article', { name: 'Interview of Elena Torres' })
    expect(listReviews).toHaveBeenLastCalledWith('c1', 'completed')
    expect(card).toHaveTextContent('Accept for all worlds')
    expect(card).toHaveTextContent('Deny for this world')
    expect(within(card).queryByRole('radio')).not.toBeInTheDocument()

    await user.click(within(card).getAllByRole('button', { name: 'Change ruling' })[0])
    await user.click(within(card).getByRole('radio', { name: 'Deny for all worlds' }))
    expect(decideFact).toHaveBeenCalledWith('c1', 'r1', 'f1', 'deny_case')
    expect(within(card).queryByRole('radio')).not.toBeInTheDocument()
  })

  it('shows a review still being summarized, and retries one that failed', async () => {
    const failed = { ...review, id: 'r2', status: 'failed' as const, error: 'Could not list the new facts.', facts: [] }
    const summarizing = { ...review, id: 'r3', status: 'summarizing' as const, facts: [] }
    const retryReview = vi.fn().mockResolvedValue({ ...failed, status: 'summarizing', error: null })
    const { user } = renderPage({ listReviewQueue: queue([failed, summarizing]), retryReview })

    expect(await screen.findByText('Could not list the new facts.')).toBeInTheDocument()
    expect(screen.getByText('Listing the new facts in this conversation…')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    expect(retryReview).toHaveBeenCalledWith('c1', 'r2')
    expect(screen.getAllByText('Listing the new facts in this conversation…')).toHaveLength(2)
  })

  it('opens the conversation behind a review on request', async () => {
    const getReviewTranscript = vi.fn().mockResolvedValue({
      marked: true,
      turns: [
        { position: 0, question: 'Where were you at 3?', objection: 'Ms. Park: Objection, form.', answer: 'On break.', askedBy: 'Ada Lawyer', struck: 'all', reasons: [{ kind: 'produced', fact: 'Torres was on break at 3:00.' }] },
      ],
    })
    const { user } = renderPage({ listReviewQueue: queue([review]), getReviewTranscript })

    await user.click(await screen.findByText('Show conversation'))
    expect(getReviewTranscript).toHaveBeenCalledWith('c1', 'r1')
    expect(await screen.findByText(/Where were you at 3\?/)).toBeInTheDocument()
    expect(screen.getByText('Ms. Park: Objection, form.')).toBeInTheDocument()
    // A denied fact's exchange shows struck out, as the team will see it.
    expect(screen.getByText(/Where were you at 3\?/).closest('p')).toHaveClass('transcript-strike')
    expect(screen.getByText('Denied:')).toBeInTheDocument()
  })

  it('opens the facts of the review’s world on request', async () => {
    const getCaseFacts = vi.fn().mockResolvedValue({
      ...facts,
      worlds: [{ matchupId: 'mu2', number: 2, teams: [], accepted: [{ text: 'The gate was open.', source: 'Interview of Elena Torres · Team 3', auto: false }], denied: [] }],
    })
    const { user } = renderPage({ listReviewQueue: queue([review]), getCaseFacts })
    const card = await screen.findByRole('article', { name: 'Interview of Elena Torres' })
    await user.click(within(card).getByText('World B facts'))
    expect(await within(card).findByText('The gate was open.')).toBeInTheDocument()
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
    const decideDocument = vi.fn().mockResolvedValue({
      ...investigation,
      status: 'finalizing',
      documents: [{ materialId: 'm9', title: 'Inspection log', decision: 'deny' }],
    })
    const { user } = renderPage({ listReviewQueue: queue([investigation]), decideDocument })

    const card = await screen.findByRole('article', { name: 'Investigation for Team 3' })
    expect(card).toHaveTextContent('Assignment from Ada Lawyer')
    expect(card).toHaveTextContent('Check the lift hill.')
    expect(card).toHaveTextContent('1. I photographed the lift hill.')
    expect(card).toHaveTextContent("The park's maintenance records, by subpoena.")
    expect(within(card).queryByText('Show conversation')).not.toBeInTheDocument()
    expect(card).toHaveTextContent('1 of 1 ruled · 0 of 1 files decided')

    const file = within(card).getByRole('radiogroup', { name: 'Allow Team 3 access to Inspection log' })
    await user.click(within(file).getByRole('radio', { name: "Don't allow" }))
    expect(decideDocument).toHaveBeenCalledWith('c1', 'r5', 'm9', 'deny')

    // The last call finishes it; the team's report is written in Completed.
    expect(await screen.findByRole('status')).toHaveTextContent('Investigation for Team 3 is done; their report is being written.')
    expect(screen.queryByRole('article', { name: 'Investigation for Team 3' })).not.toBeInTheDocument()
  })

  it("sends on a report with nothing to rule on, and warns when the investigator didn't list his new facts or files", async () => {
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
    const completeReview = vi.fn().mockResolvedValue({ ...investigation, status: 'finalizing' })
    const { user } = renderPage({ listReviewQueue: queue([investigation]), completeReview })

    const card = await screen.findByRole('article', { name: 'Investigation for Team 3' })
    expect(within(card).getByRole('note')).toHaveTextContent("The investigator didn’t list his new facts or files.")
    await user.click(within(card).getByRole('button', { name: 'Send to Team 3' }))
    expect(completeReview).toHaveBeenCalledWith('c1', 'r6')
    expect(screen.queryByRole('article', { name: 'Investigation for Team 3' })).not.toBeInTheDocument()
  })
})

describe('ReviewPage: similar facts', () => {
  const group: FactGroup = {
    id: 'g1',
    caseId: 'k1',
    caseTitle: 'Rivera v. Thrill Park',
    headline: 'Teams 1 and 3 both got medical bills from Torres.',
    differences: '$6,000 (Team 1) vs. $8,000 (Team 3)',
    createdAt: '2026-10-16T15:00:00.000Z',
    facts: [
      { id: 'f1', text: 'The bills were $6,000.', reviewId: 'r1', teamNumber: 1, worldNumber: 1, source: 'Interview of Elena Torres' },
      { id: 'f9', text: 'The bills were $8,000.', reviewId: 'r9', teamNumber: 3, worldNumber: 2, source: 'Interview of Elena Torres' },
    ],
    worlds: 2,
  }

  it('rules on the group for each world, or ungroups it', async () => {
    const grouped = { ...review, facts: [{ ...review.facts[0], groupId: 'g1' }, review.facts[1]] }
    const listReviewQueue = vi
      .fn()
      .mockResolvedValueOnce({ reviews: [grouped], groups: [group], flags: [] })
      .mockResolvedValue({ reviews: [ruled(['accept_world', null])], groups: [], flags: [] })
    const { user, service } = renderPage({ listReviewQueue })

    const card = await screen.findByRole('article', { name: group.headline })
    expect(card).toHaveTextContent('$6,000 (Team 1) vs. $8,000 (Team 3)')
    expect(card).toHaveTextContent('Team 3 · World B · Interview of Elena Torres')
    expect(within(card).getByText('Show conversation · Team 1')).toBeInTheDocument()
    // In its review, the grouped fact points to the group instead of asking for a ruling.
    const reviewCard = screen.getByRole('article', { name: 'Interview of Elena Torres' })
    expect(within(reviewCard).getAllByRole('radiogroup')).toHaveLength(1)
    expect(within(reviewCard).getByRole('link', { name: 'Rule on the group' })).toHaveAttribute('href', '#group-g1')

    await user.click(within(card).getByRole('button', { name: 'Accept for these 2 worlds' }))
    expect(service.decideFactGroup).toHaveBeenCalledWith('c1', 'g1', 'accept_world')
    expect(screen.queryByRole('article', { name: group.headline })).not.toBeInTheDocument()
  })

  it('ungroups', async () => {
    const { user, service } = renderPage({ listReviewQueue: queue([], { groups: [group] }) })
    const card = await screen.findByRole('article', { name: group.headline })
    expect(within(card).getByRole('button', { name: 'Accept for all worlds' })).toBeEnabled()
    await user.click(within(card).getByRole('button', { name: 'Ungroup to rule on each' }))
    expect(service.ungroupFacts).toHaveBeenCalledWith('c1', 'g1')
  })
})

describe('ReviewPage: flags and the facts panel', () => {
  const lite = { ...ruled(['accept_world', 'accept_world']), status: 'completed' as const, facts: review.facts.map((f) => ({ ...f, decision: 'accept_world' as const, auto: true })) }
  const flag: CourseFlag = {
    id: 'fl1',
    kind: 'fact',
    caseId: 'k1',
    caseTitle: 'Rivera v. Thrill Park',
    teamNumber: 3,
    worldNumber: 2,
    raisedBy: 'Ada Lawyer',
    reason: 'Nothing was burning.',
    createdAt: '2026-10-16T15:00:00.000Z',
    factId: 'f2',
    materialId: null,
    review: lite,
    subpoena: null,
  }

  it('shows what a student flagged, and the instructor changes the call', async () => {
    const { user, service } = renderPage({ listReviewQueue: queue([], { flags: [flag] }) })
    const card = await screen.findByRole('article', { name: 'A fact from the interview of Elena Torres' })
    expect(card).toHaveTextContent('Flagged by Team 3')
    expect(card).toHaveTextContent('Nothing was burning.')
    expect(card).toHaveTextContent('Torres smelled smoke.')
    expect(within(card).getByText('Show conversation')).toBeInTheDocument()
    await user.click(within(card).getByRole('button', { name: 'Deny for this world' }))
    expect(service.resolveFlag).toHaveBeenCalledWith('c1', 'fl1', { decision: 'deny_world' })
  })

  it('lists the case’s facts, and switches it to review lite', async () => {
    const courseCase = { id: 'k1', title: 'Rivera v. Thrill Park', reviewMode: 'all' } as CourseCase
    const setReviewMode = vi.fn().mockResolvedValue({ ...courseCase, reviewMode: 'lite' })
    const { user } = renderPage({
      listCases: vi.fn().mockResolvedValue([courseCase]),
      getCaseFacts: vi.fn().mockResolvedValue({
        ...facts,
        fileFacts: { status: 'ready', facts: ['The ride stopped at 3:02.'] },
        important: { plaintiff: ['The lap bar light was red.'], defense: ['It passed inspection.'] },
        allWorlds: { accepted: [{ text: 'Torres was on break.', source: 'Interview of Elena Torres · Team 1', auto: false }], denied: [] },
        worlds: [{ matchupId: 'mu1', number: 1, teams: [{ number: 1, side: 'plaintiff' }, { number: 2, side: 'defense' }], accepted: [], denied: [] }],
      }),
      setReviewMode,
    })

    const panel = await screen.findByRole('complementary', { name: 'Facts' })
    expect(await within(panel).findByText('The ride stopped at 3:02.')).toBeInTheDocument()
    expect(panel).toHaveTextContent('The lap bar light was red.')
    expect(panel).toHaveTextContent('Torres was on break.')
    expect(panel).toHaveTextContent('World A · Team 1 (Plaintiff) v. Team 2 (Defendant)')
    expect(within(panel).getByRole('button', { name: 'Review everything' })).toHaveAttribute('aria-pressed', 'true')

    await user.click(within(panel).getByRole('button', { name: 'Review lite' }))
    expect(setReviewMode).toHaveBeenCalledWith('c1', 'k1', 'lite')
    expect(within(panel).getByRole('button', { name: 'Review lite' })).toHaveAttribute('aria-pressed', 'true')
  })
})

describe('ReviewPage: subpoenas', () => {
  const subpoena: CourseSubpoena = {
    id: 's1',
    caseId: 'k1',
    caseTitle: 'Rivera v. Thrill Park',
    parties: { plaintiff: 'Ana Rivera', defendant: 'Thrill Park' },
    firm: { firm: 'Hale & Whitford LLP', partner: 'Margaret Hale' },
    worldNumber: 1,
    teamNumber: 3,
    side: 'plaintiff',
    team: ['Ada Lawyer'],
    recipient: 'Mercy Hospital',
    recipientDescription: 'Where Ana was treated.',
    requestType: 'documents',
    records: 'ER records for June 10.',
    sentBy: 'Ada Lawyer',
    sentAt: '2026-10-28T12:00:00Z',
    dueAt: '2099-11-11T12:00:00Z',
    outcome: null,
    response: null,
    respondedAt: null,
    respondedBy: null,
    documents: [],
    status: 'open',
    draft: 'RESPONSE OF MERCY HOSPITAL TO SUBPOENA',
    flag: null,
    existing: [],
    basedOn: null,
    unknownTitles: [],
    instructions: '',
    createNew: false,
    error: null,
  }

  it('edits and sends a new response, with the AI\u2019s warning', async () => {
    const approveSubpoena = vi.fn().mockResolvedValue({ ...subpoena, status: 'answered', outcome: 'responded', respondedAt: '2026-10-30T12:00:00Z' })
    const { user } = renderPage({
      listSubpoenas: vi.fn().mockResolvedValue([{ ...subpoena, flag: 'modify' }]),
      approveSubpoena,
    })

    const card = await screen.findByRole('article', { name: 'Subpoena to Mercy Hospital' })
    expect(card).toHaveTextContent('World A · Plaintiff · Team 3 (Ada Lawyer)')
    expect(card).toHaveTextContent('The AI thinks a court would likely modify this subpoena')
    expect(within(card).getByRole('article', { name: 'Subpoena form' })).toHaveTextContent('ER records for June 10.')
    const response = within(card).getByRole('textbox', { name: /Mercy Hospital’s response/ })
    expect(response).toHaveValue('RESPONSE OF MERCY HOSPITAL TO SUBPOENA')
    await user.type(response, '{enter}Edited.')
    await user.click(within(card).getByRole('button', { name: 'Approve and send' }))
    expect(approveSubpoena).toHaveBeenCalledWith('c1', 's1', 'RESPONSE OF MERCY HOSPITAL TO SUBPOENA\nEdited.')
    expect(screen.queryByRole('article', { name: 'Subpoena to Mercy Hospital' })).not.toBeInTheDocument()
  })

  it('offers an existing file, opens it, and can ask for a new one instead', async () => {
    const withFile = { ...subpoena, existing: [{ materialId: 'm1', title: 'ER chart', producedToTeam: 4 }] }
    const redraftSubpoena = vi.fn().mockResolvedValue({ ...withFile, status: 'drafting' })
    const { user } = renderPage({
      listSubpoenas: vi.fn().mockResolvedValue([withFile]),
      listMaterials: vi.fn().mockResolvedValue([
        { id: 'm1', filename: 'er.pdf', description: 'ER chart', contentType: 'application/pdf', sizeBytes: 10, initial: false, audience: 'instructor' },
      ]),
      redraftSubpoena,
    })

    const card = await screen.findByRole('article', { name: 'Subpoena to Mercy Hospital' })
    expect(within(card).queryByRole('textbox')).not.toBeInTheDocument()
    expect(within(card).getByRole('button', { name: 'Respond with this file' })).toBeEnabled()
    // The other team's earlier response to the same request.
    expect(card).toHaveTextContent('This asks for what an earlier subpoena already got.')
    expect(card).toHaveTextContent('Produced to Team 4 earlier')
    await user.click(within(card).getByRole('button', { name: 'ER chart' }))
    expect(await screen.findByRole('dialog', { name: 'ER chart' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Close' }))

    await user.click(within(card).getByRole('button', { name: 'Create a new file instead' }))
    const dialog = await screen.findByRole('dialog', { name: 'Create a new file' })
    await user.type(within(dialog).getByRole('textbox'), 'June only.')
    await user.click(within(dialog).getByRole('button', { name: 'Submit' }))
    expect(redraftSubpoena).toHaveBeenCalledWith('c1', 's1', { instructions: 'June only.', createNew: true })
    expect(await within(card).findByText('Drafting Mercy Hospital’s response…')).toBeInTheDocument()
  })

  it('denies with a note', async () => {
    const denySubpoena = vi.fn().mockResolvedValue({ ...subpoena, status: 'answered', outcome: 'denied', respondedAt: '2026-10-30T12:00:00Z' })
    const { user } = renderPage({ listSubpoenas: vi.fn().mockResolvedValue([subpoena]), denySubpoena })
    const card = await screen.findByRole('article', { name: 'Subpoena to Mercy Hospital' })
    await user.click(within(card).getByRole('button', { name: 'Deny' }))
    const dialog = await screen.findByRole('dialog', { name: 'Deny this subpoena?' })
    await user.type(within(dialog).getByRole('textbox'), 'Overbroad.')
    await user.click(within(dialog).getByRole('button', { name: 'Deny subpoena' }))
    expect(denySubpoena).toHaveBeenCalledWith('c1', 's1', 'Overbroad.')
    expect(screen.queryByRole('article', { name: 'Subpoena to Mercy Hospital' })).not.toBeInTheDocument()
  })

  it("shows which other world's response a draft adapts, to compare", async () => {
    const { user } = renderPage({
      listSubpoenas: vi.fn().mockResolvedValue([{ ...subpoena, basedOn: { materialId: 'm7', title: 'Response of Mercy Hospital to subpoena (Team 1)', worldNumber: 2 } }]),
      listMaterials: vi.fn().mockResolvedValue([
        { id: 'm7', filename: 'r.txt', description: 'Response of Mercy Hospital to subpoena (Team 1)', contentType: 'text/plain', sizeBytes: 10, initial: false, audience: 'instructor' },
      ]),
    })
    const card = await screen.findByRole('article', { name: 'Subpoena to Mercy Hospital' })
    expect(card).toHaveTextContent('Adapted from World B’s response to the same request')
    // Still a draft to edit, not a file to send.
    expect(within(card).getByRole('button', { name: 'Approve and send' })).toBeEnabled()
    await user.click(within(card).getByRole('button', { name: 'Response of Mercy Hospital to subpoena (Team 1)' }))
    expect(await screen.findByRole('dialog', { name: 'Response of Mercy Hospital to subpoena (Team 1)' })).toBeInTheDocument()
  })
})
