import { render, screen, waitFor } from '@testing-library/react'
import type { DragEndEvent } from '@dnd-kit/core'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { CourseServiceContext } from '../../courses/CourseServiceContext'
import type { CaseTeams, RosterEntry } from '../../courses/types'
import { fakeCourseService } from '../../test/fakeCourseService'
import { TeamsSection } from './TeamsSection'

// Real drags need a layout jsdom doesn't have, so stand in for the drag areas
// (one for teams, one for worlds, by id) and call their drop handlers
// directly, as a finished drag would.
const drops: Record<string, (event: DragEndEvent) => void> = {}
vi.mock('@dnd-kit/core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@dnd-kit/core')>()),
  DndContext: ({ id, onDragEnd, children }: { id: string; onDragEnd: (event: DragEndEvent) => void; children: ReactNode }) => {
    drops[id] = onDragEnd
    return children
  },
}))

const student = (name: string): RosterEntry => ({ email: `${name}@example.com`, name, joined: true })
const [ada, ben, cy, dee, eve] = ['Ada', 'Ben', 'Cy', 'Dee', 'Eve'].map(student)
const data: CaseTeams = {
  teams: [
    { id: 't1', number: 1, members: [ada, ben] },
    { id: 't2', number: 2, members: [cy] },
    { id: 't3', number: 3, members: [eve] },
  ],
  unpaired: [dee],
  matchups: [],
}
const dragged = (id: string, overId: string | null) => ({ active: { id }, over: overId && { id: overId } }) as DragEndEvent

async function renderTeams() {
  const service = fakeCourseService({
    listTeams: vi.fn().mockResolvedValue(data),
    removeTeamMember: vi.fn().mockResolvedValue(data),
    addTeamMember: vi.fn().mockResolvedValue(data),
    createMatchup: vi.fn().mockResolvedValue(data),
  })
  render(
    <CourseServiceContext.Provider value={service}>
      <TeamsSection courseId="c1" caseId="k1" closed={false} />
    </CourseServiceContext.Provider>,
  )
  await screen.findByRole('heading', { name: 'Team 1' })
  return service
}

describe('dragging students between teams', () => {
  it('moves a student from one team to another', async () => {
    const service = await renderTeams()
    drops['teams-dnd'](dragged(ada.email, 'team:t2'))

    await waitFor(() => expect(service.addTeamMember).toHaveBeenCalledWith('c1', 'k1', 't2', ada.email))
    expect(service.removeTeamMember).toHaveBeenCalledWith('c1', 'k1', 't1', ada.email)
  })

  it('adds an unpaired student to a team, or takes one off their team', async () => {
    const service = await renderTeams()
    drops['teams-dnd'](dragged(dee.email, 'team:t2'))
    await waitFor(() => expect(service.addTeamMember).toHaveBeenCalledWith('c1', 'k1', 't2', dee.email))
    expect(service.removeTeamMember).not.toHaveBeenCalled()

    drops['teams-dnd'](dragged(cy.email, 'unpaired'))
    await waitFor(() => expect(service.removeTeamMember).toHaveBeenCalledWith('c1', 'k1', 't2', cy.email))
    expect(service.addTeamMember).toHaveBeenCalledTimes(1)
  })

  it('does nothing when dropped back where it started or outside', async () => {
    const service = await renderTeams()
    drops['teams-dnd'](dragged(ada.email, 'team:t1'))
    drops['teams-dnd'](dragged(dee.email, 'unpaired'))
    drops['teams-dnd'](dragged(ada.email, null))

    expect(service.removeTeamMember).not.toHaveBeenCalled()
    expect(service.addTeamMember).not.toHaveBeenCalled()
  })
})

describe('dragging teams into a case world', () => {
  it('makes the world once both sides have a team', async () => {
    const service = await renderTeams()
    drops['worlds-dnd'](dragged('t2', 'slot:plaintiff'))
    expect(await screen.findByText('Team 2: Cy')).toBeInTheDocument()
    expect(service.createMatchup).not.toHaveBeenCalled()

    drops['worlds-dnd'](dragged('t1', 'slot:defense'))
    await waitFor(() => expect(service.createMatchup).toHaveBeenCalledWith('c1', 'k1', 't2', 't1'))
  })

  it("moves a team to the other side instead of putting it on both", async () => {
    const service = await renderTeams()
    drops['worlds-dnd'](dragged('t2', 'slot:plaintiff'))
    await waitFor(() => expect(screen.getByLabelText('Plaintiff')).toHaveValue('t2'))
    drops['worlds-dnd'](dragged('t2', 'slot:defense'))
    await waitFor(() => expect(screen.getByLabelText('Defense')).toHaveValue('t2'))
    expect(screen.getByLabelText('Plaintiff')).toHaveValue('')
    expect(service.createMatchup).not.toHaveBeenCalled()

    drops['worlds-dnd'](dragged('t3', 'outside'))
    expect(service.createMatchup).not.toHaveBeenCalled()
  })
})
