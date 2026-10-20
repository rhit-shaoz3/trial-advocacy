import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import type { CaseWorkspace } from '../courses/types'
import { CaseWorkspaceView } from './CaseWorkspaceView'

const NOW = new Date('2026-10-15T09:00:00')

const member = (name: string, you = false) => ({
  email: `${name.split(' ')[0].toLowerCase()}@example.com`,
  name,
  joined: true,
  you,
})

const sampleWorkspace: CaseWorkspace = {
  case: {
    id: 'k1',
    title: 'Rivera v. Thrill Park',
    summary: 'A rollercoaster stalls at the top of its lift hill.',
    status: 'active',
    phase: 'subpoena',
    instructorNote: 'Mind the timeline.',
  },
  team: { number: 7, members: [member('Ada Lawyer', true), member('Ben Partner')] },
  world: {
    number: 4,
    side: 'defense',
    opponents: { number: 3, members: [member('Cy Counsel'), member('Dee Advocate')] },
  },
  side: 'defense',
  materials: [
    {
      id: 'm1',
      audience: 'all',
      filename: 'Fact pattern.pdf',
      description: 'Read first.',
      contentType: 'application/pdf',
      sizeBytes: 250_000,
      uploadedAt: '2026-10-01T15:00:00.000Z',
      textStatus: 'ready',
      textError: null,
      initial: true,
    },
    {
      id: 'm2',
      audience: 'defense',
      filename: 'Incident report.pdf',
      description: '',
      contentType: 'application/pdf',
      sizeBytes: 1200,
      uploadedAt: '2026-10-02T15:00:00.000Z',
      textStatus: 'ready',
      textError: null,
      initial: false,
    },
    {
      id: 'm3',
      audience: 'all',
      filename: 'Ride photo.jpg',
      description: 'Taken after the stop.',
      contentType: 'image/jpeg',
      sizeBytes: 3_000_000,
      uploadedAt: '2026-10-03T15:00:00.000Z',
      textStatus: 'ready',
      textError: null,
      initial: false,
    },
    {
      id: 'm4',
      audience: 'all',
      filename: '911 call.mp3',
      description: '',
      contentType: 'audio/mpeg',
      sizeBytes: 900_000,
      uploadedAt: '2026-10-04T15:00:00.000Z',
      textStatus: 'ready',
      textError: null,
      initial: false,
    },
  ],
  witnesses: [{ id: 'w1', name: 'Elena Torres', role: 'Ride operator', description: 'At the controls.', audience: 'all', side: null, canInterview: false }],
  investigatorAvailable: false,
  tasks: [
    {
      id: 't1',
      title: 'Read the fact pattern',
      description: '',
      dueAt: '2026-10-10T23:59:00.000Z',
      audience: 'all',
      completedAt: '2026-10-09T12:00:00.000Z',
      completedBy: 'Ben Partner',
    },
    {
      id: 't2',
      title: 'Outline the deposition',
      description: 'List your exhibits.',
      dueAt: '2026-10-12T23:59:00.000Z',
      audience: 'defense',
      completedAt: null,
      completedBy: null,
    },
    {
      id: 't3',
      title: 'Interview the operator',
      description: '',
      dueAt: null,
      audience: 'all',
      completedAt: null,
      completedBy: null,
    },
  ],
  preview: false,
}

function renderView(props: Partial<Parameters<typeof CaseWorkspaceView>[0]> = {}) {
  const user = userEvent.setup()
  render(
    <MemoryRouter>
      <CaseWorkspaceView
        workspace={sampleWorkspace}
        downloadUrl={(id) => `/files/${id}`}
        instructorName="Prof. Ruiz"
        now={NOW}
        {...props}
      />
    </MemoryRouter>,
  )
  return { user }
}

describe('CaseWorkspaceView', () => {
  it('shows the case, the world and role, and an overview', () => {
    renderView()

    expect(screen.getByRole('heading', { level: 1, name: 'Rivera v. Thrill Park' })).toBeInTheDocument()
    expect(screen.getByText('Active case')).toBeInTheDocument()
    expect(screen.getByText('Case world D')).toBeInTheDocument()
    expect(screen.getByText('Role: Defendant · Team 7')).toBeInTheDocument()

    const progress = screen.getByRole('region', { name: 'Case progress' })
    expect(within(progress).getByRole('progressbar')).toHaveAttribute('aria-valuenow', '33')
    expect(progress).toHaveTextContent('1 of 3 tasks complete')

    // The overview shows only the initial file, not the case summary or the rest of the case file.
    const background = screen.getByRole('region', { name: 'Case background' })
    expect(background).not.toHaveTextContent('A rollercoaster stalls')
    expect(within(background).getAllByRole('link')).toHaveLength(1)
    expect(within(background).getByRole('link', { name: /Fact pattern\.pdf/ })).toHaveAttribute('href', '/files/m1')
    expect(screen.getByRole('button', { name: /Case file2 documents · 1 image · 1 audio/ })).toBeInTheDocument()
  })

  it("shows the next open task, the student's team and their opponents, and the instructor note", () => {
    renderView()

    const next = screen.getByRole('region', { name: 'Next task' })
    expect(next).toHaveTextContent('Outline the deposition')
    expect(within(next).getByText(/Due Oct 12/)).toHaveClass('cw-overdue')

    const team = screen.getByRole('region', { name: 'Your team' })
    const [ours, theirs] = within(team).getAllByRole('list')
    expect(team).toHaveTextContent('Defendant · Team 7')
    expect(within(ours).getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      'ALAda Lawyer (you)Defense counsel',
      'BPBen PartnerDefense counsel',
    ])
    expect(within(team).getByRole('heading', { name: 'Opposing team' })).toBeInTheDocument()
    expect(team).toHaveTextContent('Plaintiff · Team 3')
    expect(within(theirs).getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      'CCCy CounselPlaintiff counsel',
      'DADee AdvocatePlaintiff counsel',
    ])

    const note = screen.getByRole('region', { name: 'Instructor note' })
    expect(note).toHaveTextContent('Mind the timeline.')
    expect(note).toHaveTextContent('Prof. Ruiz')
  })

  it('opens the case file, grouped by kind of file, and the witnesses and tasks tabs', async () => {
    const { user } = renderView()

    await user.click(screen.getByRole('button', { name: /^Case file/ }))
    expect(screen.getByRole('tab', { name: 'Case file, 4' })).toHaveAttribute('aria-selected', 'true')
    const documents = screen.getByRole('region', { name: 'Documents 2' })
    const report = within(documents).getByRole('link', { name: /Incident report\.pdf/ })
    expect(report).toHaveAttribute('href', '/files/m2')
    expect(report).toHaveTextContent('Defense only')
    expect(within(documents).getByRole('link', { name: /Fact pattern\.pdf/ })).toHaveTextContent('Start here')
    const images = screen.getByRole('region', { name: 'Images 1' })
    expect(within(images).getByRole('link', { name: /Ride photo\.jpg/ })).toHaveTextContent('Image')
    expect(screen.getByRole('region', { name: 'Audio 1' })).toHaveTextContent('911 call.mp3')
    expect(screen.queryByRole('region', { name: /Video/ })).not.toBeInTheDocument()

    await user.click(screen.getByRole('tab', { name: 'Witnesses, 1' }))
    expect(screen.getByRole('tabpanel')).toHaveTextContent('Elena TorresRide operatorAt the controls.')

    await user.click(screen.getByRole('tab', { name: /^Tasks/ }))
    const panel = screen.getByRole('tabpanel')
    expect(panel).toHaveTextContent('Completed by Ben Partner')
    expect(panel).toHaveTextContent('Overdue')
    expect(panel).toHaveTextContent('No due date')
  })

  it('lets a team member tick tasks off', async () => {
    const onToggleTask = vi.fn().mockResolvedValue(undefined)
    const { user } = renderView({ onToggleTask })

    await user.click(screen.getByRole('button', { name: /Mark complete/ }))
    expect(onToggleTask).toHaveBeenCalledWith('t2', true)

    await user.click(screen.getByRole('tab', { name: /Tasks/ }))
    const done = screen.getByRole('checkbox', { name: 'Read the fact pattern: mark as not done' })
    expect(done).toHaveAttribute('aria-checked', 'true')
    await user.click(done)
    expect(onToggleTask).toHaveBeenCalledWith('t1', false)
  })

  it('is read-only without a toggle handler, as in the instructor preview', async () => {
    const { user } = renderView({ workspace: { ...sampleWorkspace, preview: true } })

    expect(screen.queryByRole('button', { name: /Mark complete/ })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'View all tasks' }))
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
  })

  it('explains what is missing for a student not yet on a team, or not yet matched', () => {
    renderView({
      workspace: { ...sampleWorkspace, team: null, world: null, side: null, materials: [], tasks: [] },
    })
    expect(screen.getByText('Not on a team yet')).toBeInTheDocument()
    expect(screen.getByText('The case background hasn’t been posted yet.')).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Next task' })).toHaveTextContent('No tasks have been assigned yet.')
    const team = screen.getByRole('region', { name: 'Your team' })
    expect(team).toHaveTextContent('Not on a team yet.')
    expect(within(team).queryByRole('heading', { name: 'Opposing team' })).not.toBeInTheDocument()
  })

  it('says when the opponents will appear, for a team not yet matched', () => {
    renderView({ workspace: { ...sampleWorkspace, world: null, side: null } })
    const team = screen.getByRole('region', { name: 'Your team' })
    expect(team).toHaveTextContent('Team 7 · Waiting for a case world')
    expect(within(team).getAllByRole('listitem')).toHaveLength(2)
    expect(team).toHaveTextContent('Ben PartnerTeammate')
    expect(team).toHaveTextContent('Your opponents appear once your team is matched.')
  })

  it("links each AI witness to the team's interview", async () => {
    const { user } = renderView({
      workspace: {
        ...sampleWorkspace,
        witnesses: [
          { ...sampleWorkspace.witnesses[0], canInterview: true },
          { id: 'w2', name: 'Bystander', role: '', description: '', audience: 'all', side: null, canInterview: false },
        ],
      },
      interviewHref: (id) => `/interview/${id}`,
    })
    await user.click(screen.getByRole('tab', { name: 'Witnesses, 2' }))
    expect(screen.getByRole('link', { name: 'Interview Elena Torres' })).toHaveAttribute('href', '/interview/w1')
    expect(screen.queryByRole('link', { name: 'Interview Bystander' })).not.toBeInTheDocument()
  })

  it("shows the Interview button in the instructor's preview without opening anything", async () => {
    const { user } = renderView({
      workspace: { ...sampleWorkspace, preview: true, witnesses: [{ ...sampleWorkspace.witnesses[0], canInterview: true }] },
    })
    await user.click(screen.getByRole('tab', { name: 'Witnesses, 1' }))
    expect(screen.getByRole('tabpanel')).toHaveTextContent('Interview')
    expect(screen.queryByRole('link', { name: /Interview/ })).not.toBeInTheDocument()
  })
})

describe('CaseWorkspaceView phases', () => {
  // Ada's team is on the defense (sampleWorkspace.side).
  const elena = { ...sampleWorkspace.witnesses[0], side: 'defense' as const, canInterview: true }
  const rider = { id: 'w2', name: 'Riley Rivera', role: 'Rider', description: '', audience: 'all' as const, side: 'plaintiff' as const, canInterview: true }

  it('shows the phase and keeps the investigator locked in subpoena', async () => {
    const { user } = renderView()
    expect(screen.getByText('Subpoena phase')).toBeInTheDocument()

    await user.click(screen.getByRole('tab', { name: 'Investigator' }))
    expect(screen.getByRole('tabpanel')).toHaveTextContent(
      'Your background investigator becomes available in the investigate phase.',
    )
  })

  it('opens the investigator from the investigate phase on', async () => {
    const { user } = renderView({
      workspace: { ...sampleWorkspace, case: { ...sampleWorkspace.case, phase: 'investigate' }, investigatorAvailable: true },
    })
    expect(screen.getByText('Investigate phase')).toBeInTheDocument()
    await user.click(screen.getByRole('tab', { name: 'Investigator' }))
    expect(screen.getByRole('tabpanel')).toHaveTextContent('Your background investigator is on the way.')
  })

  it("says the other side's witnesses come in the deposition phase", async () => {
    const { user } = renderView({ workspace: { ...sampleWorkspace, witnesses: [elena] }, interviewHref: (id) => `/interview/${id}` })
    await user.click(screen.getByRole('tab', { name: 'Witnesses, 1' }))
    expect(screen.getByRole('tabpanel')).toHaveTextContent("The other side's witnesses are revealed in the deposition phase.")
    expect(screen.getByRole('link', { name: 'Interview Elena Torres' })).toBeInTheDocument()
  })

  it("lets the team depose the other side's witnesses in the deposition phase", async () => {
    const { user } = renderView({
      workspace: {
        ...sampleWorkspace,
        case: { ...sampleWorkspace.case, phase: 'deposition' },
        investigatorAvailable: true,
        witnesses: [elena, rider],
      },
      interviewHref: (id) => `/interview/${id}`,
    })
    await user.click(screen.getByRole('tab', { name: 'Witnesses, 2' }))
    expect(screen.getByRole('link', { name: 'Interview Elena Torres' })).toHaveAttribute('href', '/interview/w1')
    expect(screen.getByRole('link', { name: 'Depose Riley Rivera' })).toHaveAttribute('href', '/interview/w2')
    expect(screen.getByText("Plaintiff's witness")).toBeInTheDocument()
    expect(screen.queryByText("Defense's witness")).not.toBeInTheDocument()
  })
})
