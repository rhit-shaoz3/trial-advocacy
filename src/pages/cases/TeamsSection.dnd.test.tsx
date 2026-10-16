import { render, screen, waitFor } from '@testing-library/react'
import type { DragEndEvent } from '@dnd-kit/core'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { CourseServiceContext } from '../../courses/CourseServiceContext'
import type { CaseTeams, RosterEntry } from '../../courses/types'
import { fakeCourseService } from '../../test/fakeCourseService'
import { TeamsSection } from './TeamsSection'

// Real drags need a layout jsdom doesn't have, so stand in for the drag context
// and call its drop handler directly, as a finished drag would.
let drop: (event: DragEndEvent) => void = () => {}
vi.mock('@dnd-kit/core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@dnd-kit/core')>()),
  DndContext: ({ onDragEnd, children }: { onDragEnd: (event: DragEndEvent) => void; children: ReactNode }) => {
    drop = onDragEnd
    return children
  },
}))

const student = (name: string): RosterEntry => ({ email: `${name}@example.com`, name, userId: 'u', status: 'joined' })
const [ada, ben, cy, dee] = ['Ada', 'Ben', 'Cy', 'Dee'].map(student)
const data: CaseTeams = {
  teams: [
    { id: 't1', number: 1, members: [ada, ben] },
    { id: 't2', number: 2, members: [cy] },
  ],
  unpaired: [dee],
  matchups: [],
}
const dragged = (email: string, overId: string | null) => ({ active: { id: email }, over: overId && { id: overId } }) as DragEndEvent

async function renderTeams() {
  const service = fakeCourseService({
    listTeams: vi.fn().mockResolvedValue(data),
    removeTeamMember: vi.fn().mockResolvedValue(data),
    addTeamMember: vi.fn().mockResolvedValue(data),
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
    drop(dragged(ada.email, 't2'))

    await waitFor(() => expect(service.addTeamMember).toHaveBeenCalledWith('c1', 'k1', 't2', ada.email))
    expect(service.removeTeamMember).toHaveBeenCalledWith('c1', 'k1', 't1', ada.email)
  })

  it('adds an unpaired student, or takes one off their team', async () => {
    const service = await renderTeams()
    drop(dragged(dee.email, 't2'))
    await waitFor(() => expect(service.addTeamMember).toHaveBeenCalledWith('c1', 'k1', 't2', dee.email))
    expect(service.removeTeamMember).not.toHaveBeenCalled()

    drop(dragged(cy.email, 'unpaired'))
    await waitFor(() => expect(service.removeTeamMember).toHaveBeenCalledWith('c1', 'k1', 't2', cy.email))
    expect(service.addTeamMember).toHaveBeenCalledTimes(1)
  })

  it('does nothing when dropped back where it started or outside', async () => {
    const service = await renderTeams()
    drop(dragged(ada.email, 't1'))
    drop(dragged(dee.email, 'unpaired'))
    drop(dragged(ada.email, null))

    expect(service.removeTeamMember).not.toHaveBeenCalled()
    expect(service.addTeamMember).not.toHaveBeenCalled()
  })
})
