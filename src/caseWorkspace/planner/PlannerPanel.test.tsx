import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { PlannerCard, PlannerChange, PlannerChart, PlannerFeedback, PlannerGap, PlannerReview, PlannerSource } from '../../courses/types'
import { PlannerPanel } from './PlannerPanel'
import type { PlannerActions } from './usePlanner'
import type { FeedbackActions } from './usePlannerFeedback'

const card = (over: Partial<PlannerCard>): PlannerCard => ({
  id: 'c1',
  parentId: null,
  title: '',
  notes: '',
  position: 0,
  evidence: [],
  witnessIds: [],
  updatedBy: null,
  updatedAt: '2026-11-18T12:00:00Z',
  ...over,
})

const gap = (over: Partial<PlannerGap>): PlannerGap => ({
  id: 'g1',
  cardId: null,
  description: '',
  position: 0,
  tools: [],
  updatedBy: null,
  updatedAt: '2026-11-18T12:00:00Z',
  ...over,
})

const witnesses = [
  { id: 'w1', name: 'Tom Becker', role: 'Ride operator' },
  { id: 'w2', name: 'Paige Winston', role: 'Plaintiff' },
]

const sources: PlannerSource[] = [
  { kind: 'material', id: 'm1', title: 'Medical records.pdf', group: 'case-file', paged: true },
  {
    kind: 'interview',
    id: 'i1',
    title: 'Deposition of Tom Becker (Nov 2)',
    group: 'interviews',
    parts: [
      { n: 0, question: 'Your job?', text: 'I ran the ride.' },
      { n: 1, question: 'The light?', text: 'It was red.' },
    ],
  },
]

/** Fake planner calls: each change is recorded and applied to the chart the way the server would. */
function fake(initial: PlannerChart) {
  let chart = structuredClone(initial)
  const changes: PlannerChange[] = []
  let next = 1
  const actions: PlannerActions = {
    load: vi.fn(async () => structuredClone(chart)),
    sources: vi.fn(async () => sources),
    change: vi.fn(async (change: PlannerChange) => {
      changes.push(change)
      let id: string | undefined
      if (change.op === 'addCard') {
        id = `new${next++}`
        chart.cards.push(card({ id, parentId: change.parentId, title: change.title, position: chart.cards.length }))
      } else if (change.op === 'editCard') {
        chart = { ...chart, cards: chart.cards.map((c) => (c.id === change.cardId ? { ...c, ...(change.title !== undefined && { title: change.title }), ...(change.notes !== undefined && { notes: change.notes }) } : c)) }
      } else if (change.op === 'addGap') {
        id = `gap${next++}`
        chart.gaps.push(gap({ id, cardId: change.cardId, description: change.description }))
      } else if (change.op === 'setTools') {
        chart = {
          ...chart,
          gaps: chart.gaps.map((g) => (g.id === change.gapId ? { ...g, tools: change.tools.map((t, i) => ({ ...t, priority: i + 1 })) } : g)),
        }
      } else if (change.op === 'setWitnesses') {
        chart = { ...chart, cards: chart.cards.map((c) => (c.id === change.cardId ? { ...c, witnessIds: change.witnessIds } : c)) }
      }
      return { planner: structuredClone(chart), id }
    }),
  }
  return { actions, changes }
}

const renderPanel = (initial: PlannerChart, readOnly = false) => {
  const f = fake(initial)
  const user = userEvent.setup()
  render(<PlannerPanel actions={f.actions} witnesses={witnesses} rootLabel="Team 1: Plaintiff" readOnly={readOnly} />)
  return { ...f, user }
}

const chart: PlannerChart = {
  cards: [
    card({ id: 'c1', title: 'Tom sent the ride with the light red.', witnessIds: ['w1'] }),
    card({ id: 'c2', parentId: 'c1', title: 'The light was red.', evidence: [{ id: 'e1', kind: 'material', sourceId: 'm1', parts: [3], title: 'Medical records.pdf — page 3', excerpt: '', note: '' }] }),
  ],
  gaps: [gap({ id: 'g1', cardId: 'c2', description: 'Was the light working?' }), gap({ id: 'g2', description: 'Why did she ride twice?' })],
}

describe('the case planner', () => {
  it('draws the chart: facts, their sub-facts, and gaps on cards or about the whole case', async () => {
    renderPanel(chart)
    const tree = await screen.findByRole('list', { name: 'Your case chart' })
    expect(within(tree).getByText('Team 1: Plaintiff')).toBeInTheDocument()
    const fact = within(tree).getByRole('button', { name: /^Tom sent the ride with the light red\., 1 witness/ })
    expect(fact).toBeInTheDocument()
    expect(within(tree).getByRole('button', { name: /^The light was red\., 1 evidence, 1 gap/ })).toBeInTheDocument()
    expect(within(tree).getByRole('button', { name: 'Gap: Was the light working?, no tools yet' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Gaps about the whole case' })).toHaveTextContent('Why did she ride twice?')
    // The to-do list checks off facts, evidence and gaps; the tools come next, with what to do open.
    const item = (name: string) =>
      within(screen.getByRole('region', { name: 'To do' }))
        .getAllByRole('listitem')
        .find((li) => li.querySelector('summary')?.textContent?.startsWith(name))!
    expect(item('Facts of consequence')).toHaveTextContent('Facts of consequence, done')
    expect(item('Tools')).toHaveTextContent('Tools, to do')
    expect(item('Tools').querySelector('details')).toHaveAttribute('open')
    expect(item('Gaps').querySelector('details')).not.toHaveAttribute('open')
    // Each card has a plus for a sub-fact.
    expect(within(tree).getByRole('button', { name: 'Add a sub-fact to Tom sent the ride with the light red.' })).toBeInTheDocument()
  })

  it('adds a fact and saves what’s typed into it', async () => {
    const { user, changes } = renderPanel({ cards: [], gaps: [] })
    expect(await screen.findByText(/No facts of consequence yet/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Add a fact of consequence' }))
    const dialog = await screen.findByRole('dialog')
    expect(changes[0]).toEqual({ op: 'addCard', parentId: null, title: '' })
    await user.type(within(dialog).getByLabelText('Fact to prove'), 'The park knew the bar was loose.')
    await waitFor(() => expect(changes).toContainEqual({ op: 'editCard', cardId: 'new1', title: 'The park knew the bar was loose.' }), { timeout: 3000 })
    await user.click(within(dialog).getByRole('checkbox', { name: /Tom Becker/ }))
    await waitFor(() => expect(changes.at(-1)).toEqual({ op: 'setWitnesses', cardId: 'new1', witnessIds: ['w1'] }))
  })

  it('cites some pages of a file, or some Q&A of a deposition', async () => {
    const { user, changes } = renderPanel(chart)
    await user.click(await screen.findByRole('button', { name: /^The light was red\./ }))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Add evidence' }))
    const picker = await within(dialog).findByRole('group', { name: 'Add evidence' })
    await user.selectOptions(within(picker).getByLabelText('Source'), 'material:m1')
    await user.click(within(picker).getByRole('radio', { name: 'Only some pages' }))
    await user.type(within(picker).getByLabelText('Pages'), '3-5')
    await user.click(within(picker).getByRole('button', { name: 'Add evidence' }))
    await waitFor(() => expect(changes.at(-1)).toEqual({ op: 'addEvidence', cardId: 'c2', kind: 'material', id: 'm1', parts: [3, 4, 5], excerpt: '', note: '' }))

    await user.click(within(dialog).getByRole('button', { name: 'Add evidence' }))
    const again = await within(dialog).findByRole('group', { name: 'Add evidence' })
    await user.selectOptions(within(again).getByLabelText('Source'), 'interview:i1')
    await user.click(within(again).getByRole('radio', { name: 'Only some Q&A' }))
    await user.click(within(again).getByRole('checkbox', { name: /The light\?/ }))
    await user.type(within(again).getByLabelText(/The passage that matters/), 'It was red.')
    await user.click(within(again).getByRole('button', { name: 'Add evidence' }))
    await waitFor(() =>
      expect(changes.at(-1)).toEqual({ op: 'addEvidence', cardId: 'c2', kind: 'interview', id: 'i1', parts: [1], excerpt: 'It was red.', note: '' }),
    )
  })

  it('chooses and ranks the tools for a gap', async () => {
    const { user, changes } = renderPanel(chart)
    await user.click(await screen.findByRole('button', { name: /^Gap: Was the light working\?/ }))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('checkbox', { name: 'Deposition' }))
    await user.click(within(dialog).getByRole('checkbox', { name: 'Investigator' }))
    await waitFor(() => expect(changes.at(-1)).toMatchObject({ op: 'setTools', tools: [{ tool: 'deposition' }, { tool: 'investigator' }] }))
    await user.click(within(dialog).getByRole('button', { name: 'Move Investigator up' }))
    await waitFor(() => expect(changes.at(-1)).toMatchObject({ op: 'setTools', tools: [{ tool: 'investigator' }, { tool: 'deposition' }] }))
    await user.selectOptions(within(dialog).getByLabelText('Witness'), 'w1')
    await waitFor(() => expect(changes.at(-1)).toMatchObject({ op: 'setTools', tools: [{ tool: 'investigator' }, { tool: 'deposition', witnessId: 'w1' }] }))
    const ranked = within(dialog).getAllByRole('listitem').filter((li) => li.classList.contains('pl-tool'))
    expect(ranked.map((li) => li.querySelector('strong')?.textContent)).toEqual(['Investigator', 'Deposition'])
  })

  it('goes back to the fact a sub-fact was opened from, and moves a card with the keyboard', async () => {
    const { user, changes } = renderPanel(chart)
    await user.click(await screen.findByRole('button', { name: /^Tom sent the ride with the light red\./ }))
    const first = await screen.findByRole('dialog')
    await user.click(within(first).getByRole('button', { name: 'The light was red.' }))
    const second = await screen.findByRole('dialog')
    await user.click(within(second).getByRole('button', { name: 'Back to “Tom sent the ride with the light red.”' }))
    expect(await screen.findByRole('dialog')).toHaveTextContent('Fact of consequence')

    // The plus on a card adds a sub-fact under it.
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Close' }))
    await user.click(screen.getByRole('button', { name: 'Add a sub-fact to The light was red.' }))
    await waitFor(() => expect(changes.at(-1)).toEqual({ op: 'addCard', parentId: 'c2', title: '' }))
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Close' }))

    // Making the sub-fact a fact of consequence, without dragging.
    await user.click(screen.getByRole('button', { name: /^The light was red\./ }))
    await user.selectOptions(within(await screen.findByRole('dialog')).getByLabelText('Belongs under'), '')
    await waitFor(() => expect(changes.at(-1)).toEqual({ op: 'moveCard', cardId: 'c2', parentId: null, index: 1 }))
  })

  it('is read-only for the instructor', async () => {
    const { user } = renderPanel(chart, true)
    await user.click(await screen.findByRole('button', { name: /^Tom sent the ride/ }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).queryByRole('textbox')).not.toBeInTheDocument()
    expect(within(dialog).queryByRole('button', { name: 'Add evidence' })).not.toBeInTheDocument()
    expect(within(dialog).getByRole('checkbox', { name: /Tom Becker/ })).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Add a fact of consequence' })).not.toBeInTheDocument()
  })
})

const round = (over: Partial<PlannerReview>): PlannerReview => ({
  id: 'r1',
  round: 1,
  status: 'ready',
  tag: 'SMALL_EDITS',
  overview: 'Your elements are covered.',
  bigPicture: 'What is the park’s story?',
  notes: [
    { targetKind: 'card', targetId: 'c2', text: 'Does the page say the light was red, or that it was on?' },
    { targetKind: 'gap', targetId: 'g1', text: 'What cheaper tool might tell you first?' },
  ],
  replies: [],
  askedBy: 'Bo Partner',
  mine: false,
  error: null,
  createdAt: '2026-11-18T12:00:00Z',
  completedAt: '2026-11-18T12:02:00Z',
  ...over,
})

describe('feedback on the planner', () => {
  const renderWithFeedback = (initial: PlannerFeedback, readOnly = false) => {
    const f = fake(chart)
    let state = structuredClone(initial)
    const feedback: FeedbackActions = {
      load: vi.fn(async () => structuredClone(state)),
      request: vi.fn(async () => {
        state = { ...state, used: state.used + 1, reviews: [...state.reviews, round({ id: 'r2', round: 2, status: 'working', tag: null, overview: null, notes: [], mine: true })] }
        return structuredClone(state)
      }),
      reply: vi.fn(async (reviewId, target, text) => {
        state = { ...state, reviews: state.reviews.map((r) => (r.id === reviewId ? { ...r, replies: [{ targetKind: target.kind, targetId: target.id, text, updatedBy: 'Ada Lawyer' }] } : r)) }
        return structuredClone(state)
      }),
    }
    const user = userEvent.setup()
    render(<PlannerPanel actions={f.actions} feedback={feedback} witnesses={witnesses} rootLabel="Team 1: Plaintiff" readOnly={readOnly} />)
    return { user, feedback }
  }

  it('pins each question to its card, and saves the team’s reply for the next round', async () => {
    const { user, feedback } = renderWithFeedback({ reviews: [round({})], limit: { max: 3, per: 'student' }, used: 0 })
    const node = await screen.findByRole('button', { name: /^The light was red\., 1 evidence, 1 gap, 1 feedback/ })
    await user.click(node)
    const dialog = await screen.findByRole('dialog')
    const pinned = within(dialog).getByRole('region', { name: 'Feedback on this' })
    expect(pinned).toHaveTextContent('Feedback, round 1')
    expect(pinned).toHaveTextContent('Does the page say the light was red, or that it was on?')
    await user.type(within(pinned).getByLabelText('Your reply (optional)'), 'Page 3 says red.')
    await waitFor(() => expect(feedback.reply).toHaveBeenCalledWith('r1', { kind: 'card', id: 'c2' }, 'Page 3 says red.'), { timeout: 3000 })
  })

  it('shows the rounds, and asks for the next one', async () => {
    const { user, feedback } = renderWithFeedback({ reviews: [round({})], limit: { max: 3, per: 'student' }, used: 0 })
    const shown = await screen.findByRole('region', { name: 'Feedback, round 1' })
    expect(shown).toHaveTextContent('Small edits')
    expect(shown).toHaveTextContent('asked by Bo Partner')
    expect(shown).toHaveTextContent('Your elements are covered.')
    expect(shown).toHaveTextContent('What is the park’s story?')
    // Above, beside the to-do list, and again under the chart.
    expect(screen.getAllByText('0 of 3 rounds used by you · 3 left')).toHaveLength(2)
    // A question opens what it's about.
    await user.click(within(shown).getByRole('button', { name: 'Gap: Was the light working?' }))
    expect(await screen.findByRole('dialog')).toHaveTextContent('What cheaper tool might tell you first?')
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Close' }))

    await user.click(screen.getAllByRole('button', { name: 'Ask for another round' })[1])
    expect(feedback.request).toHaveBeenCalled()
    expect(await screen.findByText(/A mentor is reading your chart/)).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Feedback on its way…' })[0]).toBeDisabled()
    expect(screen.getAllByText('1 of 3 rounds used by you · 2 left')).toHaveLength(2)
  })

  it('checks off a question once the team has replied to it', async () => {
    const replied = round({ replies: [{ targetKind: 'card', targetId: 'c2', text: 'Page 3 says red.', updatedBy: 'Ada Lawyer' }] })
    renderWithFeedback({ reviews: [replied], limit: { max: 3, per: 'student' }, used: 0 })
    const shown = await screen.findByRole('region', { name: 'Feedback, round 1' })
    const notes = within(shown).getAllByRole('listitem')
    expect(within(notes[0]).getByLabelText('Replied')).toBeInTheDocument()
    expect(within(notes[1]).queryByLabelText('Replied')).not.toBeInTheDocument()
    const tree = screen.getByRole('list', { name: 'Your case chart' })
    expect(within(tree).getByRole('button', { name: /^The light was red\..*1 feedback, replied/ })).toBeInTheDocument()
  })

  it('stops at the limit', async () => {
    renderWithFeedback({ reviews: [round({ mine: true })], limit: { max: 1, per: 'team' }, used: 1 })
    for (const button of await screen.findAllByRole('button', { name: 'Ask for another round' })) expect(button).toBeDisabled()
    expect(screen.getAllByText('1 of 1 round used by your team')).toHaveLength(2)
  })

  it('shows the instructor the rounds and replies, read-only', async () => {
    const replied = round({ replies: [{ targetKind: 'card', targetId: 'c2', text: 'Page 3 says red.', updatedBy: 'Ada Lawyer' }] })
    const { user } = renderWithFeedback({ reviews: [replied], limit: { max: 3, per: 'student' }, used: 0 }, true)
    expect(await screen.findByRole('region', { name: 'Feedback, round 1' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Ask for/ })).not.toBeInTheDocument()
    await user.click(within(screen.getByRole('list', { name: 'Your case chart' })).getByRole('button', { name: /^The light was red\./ }))
    const pinned = within(await screen.findByRole('dialog')).getByRole('region', { name: 'Feedback on this' })
    expect(pinned).toHaveTextContent('Page 3 says red.')
    expect(within(pinned).queryByRole('textbox')).not.toBeInTheDocument()
  })
})
