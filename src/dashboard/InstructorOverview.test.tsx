import { screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { InstructorClass } from '../classes/types'
import { fakeCasesApi } from '../test/fakeCasesApi'
import { fakeClassesApi } from '../test/fakeClassesApi'
import { renderWithProviders } from '../test/renderWithProviders'
import { InstructorOverview } from './InstructorOverview'

const person = (id: string) => ({ id, name: id, email: `${id}@school.edu` })

const classes: InstructorClass[] = [
  {
    id: 'c1',
    name: 'Evidence',
    joinCode: 'EVID517',
    students: [person('ana'), person('bo')],
    invitations: [],
    pendingRequests: [person('cy')],
  },
  {
    id: 'c2',
    name: 'Torts',
    joinCode: 'TORT123',
    students: [person('bo'), person('di')], // Bo is in both classes
    invitations: [],
    pendingRequests: [],
  },
]

describe('instructor overview', () => {
  it('greets the instructor and counts classes, students, cases and requests', async () => {
    renderWithProviders(<InstructorOverview />, {
      classesApi: fakeClassesApi({ listInstructorClasses: vi.fn().mockResolvedValue(classes) }),
      casesApi: fakeCasesApi({
        listInstructorCases: vi.fn().mockResolvedValue([
          {
            id: 'k1',
            name: 'Smith v. Jones',
            classId: 'c1',
            className: 'Evidence',
            published: { documents: true, characters: false, teams: false },
          },
        ]),
      }),
    })

    expect(await screen.findByRole('heading', { name: 'Welcome back, Ivy.' })).toBeInTheDocument()
    const stat = (label: string) => screen.getByText(label, { selector: '.stat-head span' }).closest('.stat-card')!
    expect(stat('Classes')).toHaveTextContent('2')
    expect(stat('Students')).toHaveTextContent('3') // distinct: ana, bo, di
    expect(stat('Cases')).toHaveTextContent('1 published to students')
    expect(stat('Seeking admission')).toHaveTextContent('1')

    const tile = screen.getByRole('article', { name: 'Evidence' })
    expect(within(tile).getByText('Smith v. Jones')).toBeInTheDocument()
    expect(within(tile).getByRole('link', { name: /Open class/ })).toHaveAttribute(
      'href',
      '/classes#class-c1',
    )
    expect(screen.getByRole('link', { name: /Create class/ })).toHaveAttribute('href', '/classes?new=1')
  })

  it('invites a new instructor to create their first class', async () => {
    renderWithProviders(<InstructorOverview />)

    expect(await screen.findByText('Let’s build your first class.')).toBeInTheDocument()
  })
})
