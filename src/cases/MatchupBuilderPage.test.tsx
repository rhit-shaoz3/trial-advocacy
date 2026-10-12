import { screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { makeCase, students } from '../test/caseFixtures'
import { fakeCasesApi } from '../test/fakeCasesApi'
import { renderWithProviders } from '../test/renderWithProviders'
import { MatchupBuilderPage } from './MatchupBuilderPage'
import type { InstructorCase } from './types'

const threeTeams = makeCase({
  teams: [
    { id: 'p1', name: 'Team 1', side: 'plaintiff', members: students.slice(0, 2) },
    { id: 'd1', name: 'Team 2', side: 'defendant', members: students.slice(2, 4) },
    { id: 'p2', name: 'Team 3', side: 'plaintiff', members: students.slice(4) },
  ],
})

async function renderBuilder(c: InstructorCase = threeTeams) {
  const casesApi = fakeCasesApi({
    getInstructorCase: vi.fn().mockResolvedValue(c),
    saveMatchups: vi.fn().mockResolvedValue(c),
  })
  const result = renderWithProviders(<MatchupBuilderPage />, {
    casesApi,
    url: '/cases/case-1/matchups',
    path: '/cases/:caseId/matchups',
  })
  await screen.findByRole('heading', { name: 'Give every team a worthy opponent.' })
  return result
}

describe('matchup builder', () => {
  it('auto-matches one pair and offers to double up the leftover team', async () => {
    const { user, casesApi } = await renderBuilder()
    await user.click(screen.getByRole('button', { name: 'Auto-match' }))

    expect(screen.getAllByRole('heading', { name: /^Match [A-Z]$/ })).toHaveLength(1)
    expect(screen.getByLabelText('Defendant team for matchup 1')).toHaveValue('d1')
    expect(screen.getByText(/couldn't be paired/)).toBeInTheDocument()

    // Whichever plaintiff team was left over, double it up against Team 2.
    const leftover = screen.getByLabelText(/^Match Team [13] with$/)
    const leftoverId = leftover.getAttribute('aria-label')!.includes('Team 1') ? 'p1' : 'p2'
    const pairedId = leftoverId === 'p1' ? 'p2' : 'p1'
    await user.selectOptions(leftover, 'd1')

    expect(screen.queryByRole('heading', { name: 'Unmatched' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Save match-ups' }))

    expect(casesApi.saveMatchups).toHaveBeenCalledWith('case-1', [
      { plaintiffTeamId: pairedId, defendantTeamId: 'd1' },
      { plaintiffTeamId: leftoverId, defendantTeamId: 'd1' },
    ])
    expect(await screen.findByText('Navigated to /cases/case-1')).toBeInTheDocument()
  })

  it('builds a matchup by hand and blocks incomplete ones', async () => {
    const { user, casesApi } = await renderBuilder()
    await user.click(screen.getByRole('button', { name: 'Add match-up' }))

    expect(screen.getByRole('list', { name: 'Before you can save' })).toHaveTextContent(
      'Match A needs both a plaintiff and a defendant team.',
    )
    expect(screen.getByRole('button', { name: 'Save match-ups' })).toBeDisabled()

    await user.selectOptions(screen.getByLabelText('Plaintiff team for matchup 1'), 'p2')
    await user.selectOptions(screen.getByLabelText('Defendant team for matchup 1'), 'd1')
    await user.click(screen.getByRole('button', { name: 'Save match-ups' }))

    expect(casesApi.saveMatchups).toHaveBeenCalledWith('case-1', [
      { plaintiffTeamId: 'p2', defendantTeamId: 'd1' },
    ])
  })

  it('lets a leftover team stay unmatched', async () => {
    const c = { ...threeTeams, matchups: [{ id: 'm1', plaintiffTeamId: 'p1', defendantTeamId: 'd1' }] }
    const { user, casesApi } = await renderBuilder(c)

    expect(screen.getByLabelText('Match Team 3 with')).toHaveValue('')
    await user.click(screen.getByRole('button', { name: 'Save match-ups' }))

    expect(casesApi.saveMatchups).toHaveBeenCalledWith('case-1', [
      { plaintiffTeamId: 'p1', defendantTeamId: 'd1' },
    ])
  })

  it('removes a matchup', async () => {
    const c = { ...threeTeams, matchups: [{ id: 'm1', plaintiffTeamId: 'p1', defendantTeamId: 'd1' }] }
    const { user } = await renderBuilder(c)
    await user.click(screen.getByRole('button', { name: 'Remove matchup 1' }))

    expect(screen.queryByRole('heading', { name: 'Match A' })).not.toBeInTheDocument()
    expect(screen.getByLabelText('Match Team 1 with')).toBeInTheDocument()
  })
})
