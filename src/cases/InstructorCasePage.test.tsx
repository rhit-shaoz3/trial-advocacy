import { screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { makeCase, students } from '../test/caseFixtures'
import { fakeCasesApi } from '../test/fakeCasesApi'
import { renderWithProviders } from '../test/renderWithProviders'
import { InstructorCasePage } from './InstructorCasePage'
import type { CasesApi, InstructorCase } from './types'

const doc = {
  id: 'doc-1',
  filename: 'police-report.pdf',
  contentType: 'application/pdf',
  sizeBytes: 2048,
  side: 'both' as const,
  uploadedAt: '2026-10-01T00:00:00.000Z',
}

async function renderPage(c: InstructorCase, overrides: Partial<CasesApi> = {}) {
  const casesApi = fakeCasesApi({ getInstructorCase: vi.fn().mockResolvedValue(c), ...overrides })
  const result = renderWithProviders(<InstructorCasePage />, {
    casesApi,
    url: '/courses/course-1/cases/case-1',
    path: '/courses/:courseId/cases/:caseId',
  })
  await screen.findByRole('heading', { name: 'Smith v. Jones' })
  return result
}

describe('instructor case page', () => {
  it('publishes each section separately', async () => {
    const c = makeCase()
    const { user, casesApi } = await renderPage(c, {
      setPublished: vi.fn().mockResolvedValue({ ...c, published: { ...c.published, documents: true } }),
    })

    await user.click(screen.getByRole('button', { name: 'Publish case files' }))

    expect(casesApi.setPublished).toHaveBeenCalledWith('case-1', { documents: true })
    expect(await screen.findByRole('button', { name: 'Unpublish case files' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Publish characters' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Publish teams and matchups' })).toBeInTheDocument()
  })

  it('uploads files with the chosen side', async () => {
    const { user, casesApi } = await renderPage(makeCase())
    const file = new File(['%PDF'], 'complaint.pdf', { type: 'application/pdf' })

    await user.selectOptions(screen.getByRole('combobox', { name: 'Visible to (new uploads)' }), 'plaintiff')
    await user.upload(screen.getByLabelText(/Upload files/), file)

    expect(casesApi.uploadDocuments).toHaveBeenCalledWith('case-1', [file], 'plaintiff')
  })

  it('adds a character and links it to a document', async () => {
    const c = makeCase({
      documents: [doc],
      characters: [
        {
          id: 'ch-1',
          name: 'Officer Diaz',
          title: 'Police Officer',
          role: 'witness',
          side: 'both',
          documentIds: [],
        },
      ],
    })
    const { user, casesApi } = await renderPage(c, {
      createCharacter: vi.fn().mockResolvedValue({}),
    })

    expect(screen.getByText('Knows nothing yet')).toBeInTheDocument()
    expect(screen.getByText('Police Officer')).toBeInTheDocument()
    await user.click(screen.getByRole('checkbox', { name: 'Officer Diaz knows police-report.pdf' }))
    expect(casesApi.setCharacterKnows).toHaveBeenCalledWith('case-1', 'ch-1', 'doc-1', true)

    const form = screen.getByRole('form', { name: 'Add character' })
    await user.type(screen.getAllByLabelText('Name')[0], 'Dr. Lee')
    await user.type(screen.getAllByLabelText('Title')[0], 'Accident reconstructionist')
    await user.selectOptions(screen.getAllByLabelText('Role')[0], 'investigator')
    await user.click(screen.getByRole('button', { name: 'Add character' }))
    expect(form).toBeInTheDocument()
    expect(casesApi.createCharacter).toHaveBeenCalledWith('case-1', {
      name: 'Dr. Lee',
      title: 'Accident reconstructionist',
      role: 'investigator',
      side: 'both',
    })
  })

  it('summarizes teams and matchups and links to the builders', async () => {
    const c = makeCase({
      teams: [
        { id: 't1', name: 'Alpha', side: 'plaintiff', members: students.slice(0, 2) },
        { id: 't2', name: 'Beta', side: 'defendant', members: students.slice(2, 4) },
      ],
      matchups: [{ id: 'm1', plaintiffTeamId: 't1', defendantTeamId: 't2' }],
    })
    await renderPage(c)

    expect(screen.getByRole('status')).toHaveTextContent("1 student isn't on a team: Ed")
    expect(screen.getByText('Alpha').closest('li, div')).toBeInTheDocument()
    expect(screen.getByText(/vs/).closest('li')).toHaveTextContent('Alpha vs Beta')
    expect(screen.getByRole('link', { name: 'Edit teams' })).toHaveAttribute(
      'href',
      '/courses/course-1/cases/case-1/teams',
    )
    expect(screen.getByRole('link', { name: 'Edit matchups' })).toHaveAttribute(
      'href',
      '/courses/course-1/cases/case-1/matchups',
    )
  })

  it('disables matchups until there are teams', async () => {
    await renderPage(makeCase())

    expect(screen.getByRole('link', { name: 'Build teams' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Edit matchups' })).toBeDisabled()
  })
})
