import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import type { CaseWorkspace, Investigation, StudentExchange } from '../courses/types'
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
    phase: 'introduction',
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
  it("shows the student's side by the party's name, once the instructor names them", () => {
    renderView({ workspace: { ...sampleWorkspace, case: { ...sampleWorkspace.case, parties: { plaintiff: 'Ana Rivera', defendant: 'Thrill Park LLC' } } } })

    expect(screen.getByText('Role: Thrill Park LLC (Defendant) · Team 7')).toBeInTheDocument()
    const team = screen.getByRole('region', { name: 'Your team' })
    expect(team).toHaveTextContent('Ana Rivera (Plaintiff) · Team 3')
  })

  it('shows the case, the world and role, and an overview', () => {
    renderView()

    expect(screen.getByRole('heading', { level: 1, name: 'Rivera v. Thrill Park' })).toBeInTheDocument()
    expect(screen.getByText('Active case')).toBeInTheDocument()
    expect(screen.getByText('Case world D')).toBeInTheDocument()
    expect(screen.getByText('Role: Defendant · Team 7')).toBeInTheDocument()

    // The navy box shows the phase and what happens in it, not task progress.
    const phase = screen.getByRole('region', { name: 'Current phase' })
    expect(within(phase).getByRole('heading', { name: 'Introduction' })).toBeInTheDocument()
    expect(phase).toHaveTextContent("meet your side's witnesses")
    expect(within(phase).getByRole('list', { name: /^Phase 1 of \d: Introduction$/ })).toBeInTheDocument()
    expect(within(phase).queryByRole('progressbar')).not.toBeInTheDocument()

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
    // A file opens in the viewer; the icon beside it downloads it.
    const report = within(documents).getByRole('button', { name: /Incident report\.pdf/ })
    expect(report).toHaveTextContent('Defense only')
    expect(within(documents).getByRole('link', { name: 'Download Incident report.pdf' })).toHaveAttribute('href', '/files/m2')
    expect(within(documents).getByRole('button', { name: /Fact pattern\.pdf/ })).toHaveTextContent('Start here')
    const images = screen.getByRole('region', { name: 'Images 1' })
    expect(within(images).getByRole('button', { name: /Ride photo\.jpg/ })).toHaveTextContent('Image')

    await user.click(report)
    const viewer = screen.getByRole('dialog', { name: 'Incident report.pdf' })
    expect(within(viewer).getByTitle('Incident report.pdf')).toHaveAttribute('src', '/files/m2?view=1')
    expect(within(viewer).getByRole('link', { name: 'Download' })).toHaveAttribute('href', '/files/m2')
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

  it('shows the phase and keeps the investigator locked in introduction', async () => {
    const { user } = renderView()
    expect(screen.getByText('Introduction phase')).toBeInTheDocument()

    await user.click(screen.getByRole('tab', { name: 'Investigator' }))
    const panel = screen.getByRole('tabpanel')
    expect(within(panel).getByRole('heading', { name: 'John Hastings' })).toBeInTheDocument()
    expect(panel).toHaveTextContent('John Hastings becomes available in the investigate phase.')
    expect(within(panel).queryByRole('form')).not.toBeInTheDocument()
  })

  it('has no investigator tab when the case has no investigator', () => {
    renderView({ workspace: { ...sampleWorkspace, investigator: null } })
    expect(screen.queryByRole('tab', { name: /Investigator/ })).not.toBeInTheDocument()
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

describe('the background investigator', () => {
  const open = {
    ...sampleWorkspace,
    case: { ...sampleWorkspace.case, phase: 'investigate' as const },
    investigator: { name: 'Nora Vance', avatarUrl: '/investigator.png' },
    investigatorAvailable: true,
  }
  const report = (over: Partial<Investigation> = {}): Investigation => ({
    id: 'i1',
    assignment: 'Check the lift hill.',
    askedBy: 'Ada Lawyer',
    sentAt: '2026-10-10T15:00:00.000Z',
    status: 'completed',
    completedAt: '2026-10-11T15:00:00.000Z',
    report: '1. I photographed the lift hill from the parking lot.',
    unlocked: [{ id: 'm9', title: 'Inspection log', filename: 'inspection.pdf', contentType: 'application/pdf', sizeBytes: 2048 }],
    seen: true,
    ...over,
  })

  it('emails him an assignment from the team', async () => {
    const onSendInvestigation = vi.fn().mockResolvedValue(undefined)
    const { user } = renderView({ workspace: open, investigations: [], onSendInvestigation })
    await user.click(screen.getByRole('tab', { name: 'Investigator' }))

    const email = screen.getByRole('form', { name: 'Email Nora Vance' })
    expect(email).toHaveTextContent('To Nora Vance')
    expect(email).toHaveTextContent('From Team 7')
    const send = within(email).getByRole('button', { name: 'Send to Nora Vance' })
    expect(send).toBeDisabled()
    await user.type(within(email).getByLabelText('Your assignment'), 'Find who else was on the ride.')
    await user.click(send)

    expect(onSendInvestigation).toHaveBeenCalledWith('Find who else was on the ride.')
    expect(within(email).getByLabelText('Your assignment')).toHaveValue('')
  })

  it('shows the request he is working on instead of the email', async () => {
    const { user } = renderView({
      workspace: open,
      investigations: [report({ status: 'working', report: null, completedAt: null, unlocked: [] })],
      onSendInvestigation: vi.fn(),
    })
    await user.click(screen.getByRole('tab', { name: 'Investigator' }))

    expect(screen.getByRole('status')).toHaveTextContent('Nora Vance is on it.')
    expect(screen.getByRole('status')).toHaveTextContent('Check the lift hill.')
    expect(screen.queryByRole('form', { name: 'Email Nora Vance' })).not.toBeInTheDocument()
  })

  it('shows his reports above the email, with the files they unlocked', async () => {
    const { user } = renderView({
      workspace: open,
      investigations: [report({ id: 'i2', assignment: 'Talk to the ride operators.', report: '1. Two operators declined to talk.' }), report()],
      onSendInvestigation: vi.fn(),
    })
    await user.click(screen.getByRole('tab', { name: 'Investigator' }))

    const panel = screen.getByRole('tabpanel')
    expect(panel).toHaveTextContent('1. Two operators declined to talk.')
    expect(within(panel).getByRole('heading', { name: 'Earlier reports' })).toBeInTheDocument()
    // The files come attached to the report, like an email.
    // An attachment opens in the viewer, with a download beside it.
    expect(within(panel).getAllByRole('button', { name: /Inspection log/ })[0]).toHaveTextContent('PDF · 2 KB')
    expect(within(panel).getAllByRole('link', { name: 'Download Inspection log' })[0]).toHaveAttribute('href', '/files/m9')
    expect(panel).toHaveTextContent('1 attachment, also in your case file')
    expect(panel).toHaveTextContent('Watch people, including named witnesses, from public places')
    // The newest report comes before the next email.
    const latest = within(panel).getByText('1. Two operators declined to talk.')
    const email = within(panel).getByRole('form', { name: 'Email Nora Vance' })
    expect(latest.compareDocumentPosition(email) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('puts his reports in the case file, and tells the team about a new one', async () => {
    const onOpenInvestigator = vi.fn()
    const { user } = renderView({ workspace: open, investigations: [report({ seen: false })], onOpenInvestigator })

    // A notification in the corner, with a button to the report.
    expect(screen.getByRole('status')).toHaveTextContent('New report from Nora Vance')
    expect(screen.getByRole('tab', { name: 'Investigator, 1' })).toBeInTheDocument()
    await user.click(screen.getByRole('tab', { name: /Case file/ }))
    expect(screen.getByRole('heading', { name: 'Investigator reports 1' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Read report' }))
    expect(onOpenInvestigator).toHaveBeenCalled()
  })

  it('opens on the tab a notice links to, and marks the report read', () => {
    const onOpenInvestigator = vi.fn()
    renderView({ workspace: open, investigations: [report({ seen: false })], onOpenInvestigator, initialTab: 'investigator' })

    expect(screen.getByRole('tab', { name: /Investigator/ })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tabpanel')).toHaveTextContent('Report')
    expect(onOpenInvestigator).toHaveBeenCalled()
  })
})

describe('CaseWorkspaceView: information exchange', () => {
  const answered = {
    id: 'r7',
    kind: 'rfas' as const,
    direction: 'sent' as const,
    worldNumber: 1,
    sentBy: 'Cy Counsel',
    sentAt: '2026-10-28T12:00:00Z',
    dueAt: '2026-11-11T12:00:00Z',
    respondedAt: '2026-10-31T12:00:00Z',
    respondedBy: 'Dee Fence',
    seen: false,
    fromTeam: { id: 't1', number: 1, side: 'plaintiff' as const },
    toTeam: { id: 't2', number: 2, side: 'defense' as const },
    items: [
      { position: 1, text: 'Admit the lift chain jerked.', weight: 1, answer: null, objection: false, admission: 'agree' as const, agreePart: null, disagreePart: null },
    ],
  }
  const exchange: StudentExchange = {
    phase: 'information_exchange',
    requestsOpen: true,
    side: 'plaintiff',
    teamNumber: 1,
    opponentNumber: 2,
    firm: { firm: 'Hale & Whitford LLP', partner: 'Margaret Hale' },
    disclosures: null,
    interrogatories: { limit: 15, days: 30, used: 0, remaining: 15, requests: [] },
    rfas: { limit: 3, days: 14, used: 1, remaining: 2, requests: [answered] },
  }

  it('opens the new response itself from the notice', async () => {
    const { user } = renderView({ exchange, onOpenExchange: vi.fn() })

    await user.click(screen.getByRole('button', { name: 'See answers' }))
    const panel = screen.getByRole('tabpanel')
    expect(panel).toHaveTextContent('Admit the lift chain jerked.')
    expect(panel).not.toHaveTextContent(/You have \d/)
  })
})
