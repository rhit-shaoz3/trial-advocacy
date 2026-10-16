import { render, screen, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import { CourseServiceContext } from '../../courses/CourseServiceContext'
import type { MyCase } from '../../courses/types'
import { fakeCourseService } from '../../test/fakeCourseService'
import { MyCasesPage } from './MyCasesPage'

function renderPage(cases: MyCase[]) {
  const service = fakeCourseService({ listMyCases: vi.fn().mockResolvedValue(cases) })
  render(
    <MemoryRouter initialEntries={['/courses/c1/cases']}>
      <CourseServiceContext.Provider value={service}>
        <Routes>
          <Route path="courses/:courseId/cases" element={<MyCasesPage />} />
        </Routes>
      </CourseServiceContext.Provider>
    </MemoryRouter>,
  )
  return service
}

describe('MyCasesPage', () => {
  it('shows each case with the student’s team, or that they are not paired yet', async () => {
    const service = renderPage([
      {
        id: 'k1',
        title: 'Rivera v. Thrill Park',
        summary: 'A rollercoaster stalls.',
        status: 'active',
        team: {
          number: 4,
          members: [
            { email: 'me@example.com', name: 'Me Student', userId: 'u1', status: 'joined' as const, you: true },
            { email: 'ben@example.com', name: 'Ben Counsel', userId: 'u1', status: 'joined' as const, you: false },
          ],
        },
        world: {
          number: 2,
          side: 'defense',
          opponents: {
            number: 7,
            members: [{ email: 'cy@example.com', name: 'Cy Advocate', userId: 'u1', status: 'joined' as const, you: false }],
          },
        },
      },
      { id: 'k2', title: 'State v. Hale', summary: '', status: 'active', team: null, world: null },
    ])

    const rivera = await screen.findByRole('listitem', { name: 'Rivera v. Thrill Park' })
    expect(service.listMyCases).toHaveBeenCalledWith('c1')
    expect(rivera).toHaveTextContent('PairingMe Student and Ben Counsel')
    expect(rivera).toHaveTextContent('RoleDefendant')
    expect(rivera).toHaveTextContent('Case worldB')
    expect(rivera).toHaveTextContent('OppositionCy Advocate')
    expect(rivera).not.toHaveTextContent(/\byou\b/i)
    expect(within(rivera).getByText('Active')).toBeInTheDocument()
    expect(within(rivera).getByRole('link')).toHaveAttribute('href', '/courses/c1/cases/k1')
    expect(screen.getByRole('listitem', { name: 'State v. Hale' })).toHaveTextContent('PairingNot assigned yet')
  })

  it('says when a paired student has no opponents yet', async () => {
    renderPage([
      {
        id: 'k1',
        title: 'Rivera v. Thrill Park',
        summary: '',
        status: 'active',
        team: { number: 1, members: [{ email: 'me@example.com', name: 'Me', userId: 'u1', status: 'joined' as const, you: true }] },
        world: null,
      },
    ])

    const rivera = await screen.findByRole('listitem', { name: 'Rivera v. Thrill Park' })
    expect(rivera).toHaveTextContent('PairingMe')
    expect(rivera).toHaveTextContent('Case worldNot assigned yet')
    expect(rivera).not.toHaveTextContent('Role')
  })

  it('says when there are no cases yet', async () => {
    renderPage([])

    expect(await screen.findByText(/No cases yet/)).toBeInTheDocument()
  })
})
