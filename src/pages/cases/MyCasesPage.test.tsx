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
            { email: 'me@example.com', name: 'Me Student', joined: true, you: true },
            { email: 'ben@example.com', name: 'Ben Counsel', joined: true, you: false },
          ],
        },
      },
      { id: 'k2', title: 'State v. Hale', summary: '', status: 'active', team: null },
    ])

    const rivera = await screen.findByRole('listitem', { name: 'Rivera v. Thrill Park' })
    expect(service.listMyCases).toHaveBeenCalledWith('c1')
    expect(rivera).toHaveTextContent('Team 4: you and Ben Counsel')
    expect(within(rivera).getByText('Active')).toBeInTheDocument()
    expect(screen.getByRole('listitem', { name: 'State v. Hale' })).toHaveTextContent('Not on a team yet.')
  })

  it('says when there are no cases yet', async () => {
    renderPage([])

    expect(await screen.findByText(/No cases yet/)).toBeInTheDocument()
  })
})
