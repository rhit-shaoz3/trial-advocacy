import { screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { fakeCasesApi } from '../test/fakeCasesApi'
import { renderWithProviders } from '../test/renderWithProviders'
import { StudentCasePage } from './StudentCasePage'
import type { StudentCase } from './types'

const base: StudentCase = {
  id: 'case-1',
  name: 'Smith v. Jones',
  courseName: 'LAW 540: Trial Advocacy',
  published: { documents: true, characters: false, teams: false },
  team: null,
  documents: [
    {
      id: 'doc-1',
      filename: 'complaint.pdf',
      contentType: 'application/pdf',
      sizeBytes: 5000,
      side: 'both',
      uploadedAt: '2026-10-01T00:00:00.000Z',
    },
  ],
  characters: null,
}

async function renderPage(c: StudentCase) {
  renderWithProviders(<StudentCasePage />, {
    casesApi: fakeCasesApi({ getStudentCase: vi.fn().mockResolvedValue(c) }),
    url: '/courses/course-1/cases/case-1',
    path: '/courses/:courseId/cases/:caseId',
  })
  await screen.findByRole('heading', { name: /Welcome to your case/ })
}

describe('student case page', () => {
  it('shows released files and placeholders for the rest', async () => {
    await renderPage(base)

    expect(screen.getByRole('link', { name: 'complaint.pdf' })).toHaveAttribute(
      'href',
      '/api/cases/case-1/documents/doc-1/file',
    )
    expect(screen.getAllByText("Your instructor hasn't released this yet.")).toHaveLength(2)
  })

  it('shows the student’s side, teammates and opponents', async () => {
    await renderPage({
      ...base,
      published: { documents: true, characters: true, teams: true },
      team: {
        id: 't1',
        name: 'Team 1',
        side: 'plaintiff',
        teammates: [{ id: 's2', name: 'Bo', email: 'bo@school.edu' }],
        opponents: [
          {
            id: 't2',
            name: 'Team 2',
            side: 'defendant',
            members: [{ id: 's3', name: 'Cy', email: 'cy@school.edu' }],
          },
        ],
      },
      characters: [{ id: 'ch-1', name: 'Officer Diaz', title: 'Police Officer', role: 'witness' }],
    })

    const hero = screen.getByRole('region', { name: 'Assigned case' })
    expect(hero).toHaveTextContent('Smith v. Jones')
    expect(hero).toHaveTextContent('Your side')
    expect(hero).toHaveTextContent('Plaintiff')

    const team = screen.getByRole('region', { name: 'Your match-up' })
    expect(team).toHaveTextContent('Team 1')
    expect(team).toHaveTextContent('Plaintiff')
    expect(team).toHaveTextContent('Bo')
    expect(team).toHaveTextContent('Opposing team')
    expect(team).toHaveTextContent('Team 2')
    expect(team).toHaveTextContent('Cy')
    const characters = screen.getByRole('region', { name: 'Characters' })
    expect(characters).toHaveTextContent('Officer Diaz')
    expect(characters).toHaveTextContent('Police Officer')
    expect(characters).toHaveTextContent('Witness')
  })

  it('explains when teams are out but the student is not on one', async () => {
    await renderPage({ ...base, published: { ...base.published, teams: true } })

    expect(screen.getAllByText("You haven't been put on a team yet.").length).toBeGreaterThan(0)
  })
})
