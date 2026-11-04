import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import { CourseServiceContext } from '../../../courses/CourseServiceContext'
import type { CourseCase, CourseService, WorldExhibits } from '../../../courses/types'
import { fakeCourseService } from '../../../test/fakeCourseService'
import { ExhibitCard } from '../PhaseCards'
import { FinalStepsTab } from './FinalStepsTab'

const rivera: CourseCase = {
  id: 'k1',
  title: 'Rivera v. Thrill Park',
  summary: '',
  status: 'active',
  phase: 'final_steps',
  instructorNote: '',
  inWorldDate: null,
  disputedIssues: '',
  importantFacts: { plaintiff: ['The light was red.'], defense: ['It passed inspection.'] },
  exhibitListEnabled: true,
  createdAt: '2026-10-01T15:00:00.000Z',
  updatedAt: '2026-10-01T15:00:00.000Z',
}

const list = (side: 'plaintiff' | 'defense', submittedAt: string | null, titles: string[]) => ({
  side,
  items: titles.map((title, i) => ({ kind: 'material' as const, id: `m${i}`, parts: null, title })),
  updatedAt: submittedAt,
  submittedAt,
  submittedBy: submittedAt ? 'Ada Lawyer' : null,
})

const worlds: WorldExhibits[] = [
  {
    matchupId: 'w1',
    worldNumber: 1,
    teams: { plaintiff: 1, defense: 2 },
    plaintiff: list('plaintiff', '2026-11-01T10:00:00Z', ['Complaint.pdf']),
    defense: list('defense', null, []),
    exhibits: [],
    finalizedAt: null,
  },
]

function renderTab(overrides: Partial<CourseService> = {}, courseCase = rivera) {
  const service = fakeCourseService({ listCaseExhibits: vi.fn().mockResolvedValue(worlds), ...overrides })
  const onCaseChange = vi.fn()
  const user = userEvent.setup()
  render(
    <MemoryRouter>
      <CourseServiceContext.Provider value={service}>
        <FinalStepsTab courseId="c1" courseCase={courseCase} onCaseChange={onCaseChange} />
      </CourseServiceContext.Provider>
    </MemoryRouter>,
  )
  return { user, service, onCaseChange }
}

describe('the instructor’s Final steps tab', () => {
  it('peeks at each world’s lists, read-only', async () => {
    const { user } = renderTab()
    await user.click(await screen.findByText('Case world A'))
    const world = screen.getAllByRole('listitem')[0]
    expect(world).toHaveTextContent('Team 1 (Plaintiff) v. Team 2 (Defense)')
    expect(world).toHaveTextContent('1 of 2 lists in')
    expect(world).toHaveTextContent('Plaintiff’s list · submitted by Ada Lawyer')
    expect(world).toHaveTextContent('Complaint.pdf')
    expect(world).toHaveTextContent('Defense’s list · not started')
    expect(screen.getByText(/Only you can see this view/)).toBeInTheDocument()
  })

  it('offers each team’s trial packet and all of them at once, and says what isn’t finished', async () => {
    const packet = {
      teamId: 't1',
      teamNumber: 1,
      side: 'plaintiff' as const,
      worldNumber: 1,
      members: ['Ada Lawyer', 'Ben Brief'],
      exhibits: 2,
      depositions: 1,
      files: 5,
      reports: 0,
      discovery: 3,
      warnings: ['The joint exhibit list isn’t final.'],
    }
    renderTab({
      listTrialPackets: vi.fn().mockResolvedValue([packet, { ...packet, teamId: 't2', teamNumber: 2, side: 'defense', warnings: [] }]),
    })
    expect(await screen.findByRole('link', { name: 'Download Team 1’s packet' })).toHaveAttribute('href', '/packets/t1')
    expect(screen.getByRole('link', { name: /Download all/ })).toHaveAttribute('href', '/packets/all')
    expect(screen.getAllByText(/1 deposition · 2 admitted exhibits · 5 case files · 0 investigator reports · 3 discovery sets/)).toHaveLength(2)
    expect(screen.getByText('The joint exhibit list isn’t final.')).toBeInTheDocument()
    expect(screen.getByText(/1 packet isn’t finished yet/)).toBeInTheDocument()
  })

  it('turns the joint exhibit list off for students', async () => {
    const off = { ...rivera, exhibitListEnabled: false }
    const { user, service, onCaseChange } = renderTab({ setExhibitListEnabled: vi.fn().mockResolvedValue(off) })
    await user.click(screen.getByRole('checkbox', { name: 'Students build a joint exhibit list' }))
    expect(service.setExhibitListEnabled).toHaveBeenCalledWith('c1', 'k1', false)
    expect(onCaseChange).toHaveBeenCalledWith(off)
  })
})

describe('the case dashboard’s exhibit card', () => {
  it('counts the teams that submitted and the worlds that finished, and links to Review', async () => {
    const service = fakeCourseService({
      getExhibitOverview: vi.fn().mockResolvedValue({ teams: 4, teamsSubmitted: 3, worlds: 2, worldsFinalized: 1, reviewsWaiting: 2 }),
    })
    render(
      <MemoryRouter>
        <CourseServiceContext.Provider value={service}>
          <ExhibitCard courseId="c1" courseCase={rivera} />
        </CourseServiceContext.Provider>
      </MemoryRouter>,
    )
    const card = screen.getByRole('region', { name: 'Exhibits for trial' })
    expect(await within(card).findByLabelText('3 of 4 teams')).toBeInTheDocument()
    expect(within(card).getByLabelText('1 of 2 case worlds')).toBeInTheDocument()
    expect(card).toHaveTextContent('2 challenges waiting for your ruling')
    expect(within(card).getByRole('link', { name: 'Go to Review' })).toHaveAttribute('href', '/courses/c1/review')
  })
})
