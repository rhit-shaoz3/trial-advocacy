import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CourseServiceContext } from '../../../courses/CourseServiceContext'
import { MemoryRouter } from 'react-router'
import type { CaseMaterial, CaseWorkspace, CourseCase, CourseService } from '../../../courses/types'
import { fakeCourseService } from '../../../test/fakeCourseService'
import { InvestigatorSection } from './InvestigatorSection'
import { LaunchPanel } from './LaunchPanel'
import { CALM_LIFTOFF_MS, LIFTOFF_MS } from './liftoff'
import { MaterialsSection } from './MaterialsSection'
import { StudentViewSection } from './StudentViewSection'
import { TasksSection } from './TasksSection'
import { WitnessesSection } from './WitnessesSection'

// The canvas isn't available in jsdom; the crop maths has its own tests.
vi.mock('../../../components/avatarCrop', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../components/avatarCrop')>()),
  cropToBlob: vi.fn().mockResolvedValue(new Blob(['cropped'], { type: 'image/jpeg' })),
}))

function renderWith(ui: ReactNode, overrides: Partial<CourseService> = {}) {
  const service = fakeCourseService(overrides)
  const user = userEvent.setup()
  render(<CourseServiceContext.Provider value={service}>{ui}</CourseServiceContext.Provider>)
  return { user, service }
}

const factPattern: CaseMaterial = {
  id: 'm1',
  audience: 'all',
  filename: 'Fact pattern.pdf',
  description: 'Read first.',
  contentType: 'application/pdf',
  sizeBytes: 250_000,
  uploadedAt: '2026-10-01T15:00:00.000Z',
  textStatus: 'ready',
  textError: null,
  initial: false,
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('LaunchPanel', () => {
  const checks = [
    { key: 'paired', ok: true, message: 'All 4 students are on a team.' },
    { key: 'matched', ok: true, message: '1 case world is set up.' },
    { key: 'caseFile', ok: false, message: 'Upload the case file.' },
  ] as const

  it('lists what is missing and only launches when everything is ready', async () => {
    renderWith(<LaunchPanel courseId="c1" caseId="k1" refreshKey={0} onLaunched={vi.fn()} />, {
      getLaunchChecks: vi.fn().mockResolvedValue(checks),
    })

    const list = await screen.findByRole('list', { name: 'Launch checklist' })
    expect(within(list).getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      'All 4 students are on a team.',
      '1 case world is set up.',
      'Upload the case file.',
    ])
    expect(screen.getByRole('button', { name: 'Launch case worlds' })).toBeDisabled()
  })

  it('launches after confirming', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const launched = { id: 'k1', status: 'active' }
    const onLaunched = vi.fn()
    const { user, service } = renderWith(<LaunchPanel courseId="c1" caseId="k1" refreshKey={0} onLaunched={onLaunched} />, {
      getLaunchChecks: vi.fn().mockResolvedValue(checks.map((c) => ({ ...c, ok: true }))),
      launchCase: vi.fn().mockResolvedValue(launched),
    })

    await user.click(await screen.findByRole('button', { name: 'Launch case worlds' }))

    expect(service.launchCase).toHaveBeenCalledWith('c1', 'k1')
    // The rocket lifts off first, then the page moves on.
    expect(await screen.findByRole('heading', { name: 'Liftoff!' })).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('Every case world is live.')
    expect(onLaunched).not.toHaveBeenCalled()
    await waitFor(() => expect(onLaunched).toHaveBeenCalledWith(launched), { timeout: LIFTOFF_MS + 1000 })
  })

  it('keeps the launch short and still with reduced motion', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('reduce'), addEventListener() {}, removeEventListener() {} }))
    const onLaunched = vi.fn()
    const { user } = renderWith(<LaunchPanel courseId="c1" caseId="k1" refreshKey={0} onLaunched={onLaunched} />, {
      getLaunchChecks: vi.fn().mockResolvedValue(checks.map((c) => ({ ...c, ok: true }))),
      launchCase: vi.fn().mockResolvedValue({ id: 'k1', status: 'active' }),
    })

    await user.click(await screen.findByRole('button', { name: 'Launch case worlds' }))
    const started = Date.now()
    await waitFor(() => expect(onLaunched).toHaveBeenCalled(), { timeout: CALM_LIFTOFF_MS + 1000 })
    expect(Date.now() - started).toBeLessThan(LIFTOFF_MS)
    vi.unstubAllGlobals()
  })
})

describe('MaterialsSection', () => {
  it('lists files with their file type and audience, which can be changed in place', async () => {
    const updateMaterial = vi.fn().mockResolvedValue({ ...factPattern, audience: 'plaintiff' })
    const onChange = vi.fn()
    const { user } = renderWith(<MaterialsSection courseId="c1" caseId="k1" onChange={onChange} />, {
      listMaterials: vi.fn().mockResolvedValue([factPattern]),
      updateMaterial,
    })

    const link = await screen.findByRole('link', { name: 'Fact pattern.pdf' })
    expect(link).toHaveAttribute('href', '/download/c1/k1/m1')
    expect(screen.getByText('244 KB · Read first.')).toBeInTheDocument()
    expect(screen.getByRole('cell', { name: 'PDF' })).toBeInTheDocument()

    await user.selectOptions(screen.getByLabelText('Who can see Fact pattern.pdf'), 'Plaintiff only')
    expect(updateMaterial).toHaveBeenCalledWith('c1', 'k1', 'm1', {
      audience: 'plaintiff',
      description: 'Read first.',
    })
    expect(onChange).toHaveBeenCalled()
  })

  it('makes a file the initial file, which everyone sees, and keeps new files to instructors', async () => {
    const report: CaseMaterial = { ...factPattern, id: 'm2', filename: 'Report.pdf', audience: 'instructor' }
    const setInitialMaterial = vi.fn().mockResolvedValue([{ ...factPattern, initial: true }, report])
    const onChange = vi.fn()
    const { user } = renderWith(<MaterialsSection courseId="c1" caseId="k1" onChange={onChange} />, {
      listMaterials: vi.fn().mockResolvedValue([factPattern, report]),
      setInitialMaterial,
    })

    expect(await screen.findByLabelText('Visible to (new files)')).toHaveValue('instructor')
    await user.click(screen.getByRole('button', { name: 'Make Fact pattern.pdf the initial file' }))
    expect(setInitialMaterial).toHaveBeenCalledWith('c1', 'k1', 'm1')
    expect(await screen.findByText('Initial file')).toBeInTheDocument()
    expect(screen.getByLabelText('Who can see Fact pattern.pdf')).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Make Report.pdf the initial file' })).toBeInTheDocument()
    expect(onChange).toHaveBeenCalled()
  })

  it('lists chosen files to label, then uploads each with its own label and audience', async () => {
    const photo = new File(['img'], 'photo.jpg', { type: 'image/jpeg' })
    const log = new File(['log'], 'Ride log (March).pdf', { type: 'application/pdf' })
    const uploadMaterial = vi.fn((_c: string, _k: string, file: File, input: { description: string }) =>
      Promise.resolve({ ...factPattern, id: file.name, filename: file.name, description: input.description }),
    )
    const onChange = vi.fn()
    const { user } = renderWith(<MaterialsSection courseId="c1" caseId="k1" onChange={onChange} />, { uploadMaterial })

    await screen.findByText(/No files uploaded yet/)
    await user.selectOptions(screen.getByLabelText('Visible to (new files)'), 'Defense only')
    fireEvent.change(screen.getByTestId('material-input'), { target: { files: [photo, log] } })

    // Nothing uploads until the files are labeled and confirmed.
    expect(screen.getByRole('heading', { name: 'Ready to upload (2)' })).toBeInTheDocument()
    expect(uploadMaterial).not.toHaveBeenCalled()
    expect(screen.getByLabelText('Label for photo.jpg')).toHaveValue('photo')
    expect(screen.getByLabelText('Label for Ride log (March).pdf')).toHaveValue('Ride log (March)')
    expect(screen.getByLabelText('Who will see photo.jpg')).toHaveValue('defense')

    await user.clear(screen.getByLabelText('Label for photo.jpg'))
    expect(screen.getByRole('button', { name: 'Upload 2 files' })).toBeDisabled()
    await user.type(screen.getByLabelText('Label for photo.jpg'), 'Ride photo')
    await user.selectOptions(screen.getByLabelText('Who will see Ride log (March).pdf'), 'Everyone')
    await user.click(screen.getByRole('button', { name: 'Upload 2 files' }))

    expect(uploadMaterial).toHaveBeenCalledWith('c1', 'k1', photo, { audience: 'defense', description: 'Ride photo' })
    expect(uploadMaterial).toHaveBeenCalledWith('c1', 'k1', log, { audience: 'all', description: 'Ride log (March)' })
    expect(await screen.findByRole('link', { name: 'photo.jpg' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: /Ready to upload/ })).not.toBeInTheDocument()
    expect(onChange).toHaveBeenCalled()
  })

  it('takes dropped files into the list, and keeps any that fail to upload', async () => {
    const good = new File(['a'], 'a.pdf', { type: 'application/pdf' })
    const bad = new File(['b'], 'b.pdf', { type: 'application/pdf' })
    const uploadMaterial = vi.fn((_c: string, _k: string, file: File) =>
      file === bad ? Promise.reject(new Error('Upload failed.')) : Promise.resolve({ ...factPattern, id: 'a', filename: 'a.pdf' }),
    )
    const { user } = renderWith(<MaterialsSection courseId="c1" caseId="k1" />, { uploadMaterial })
    await screen.findByText(/No files uploaded yet/)

    fireEvent.drop(screen.getByTestId('material-drop'), { dataTransfer: { files: [good, bad] } })
    expect(screen.getByRole('heading', { name: 'Ready to upload (2)' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Remove a.pdf' }))
    fireEvent.drop(screen.getByTestId('material-drop'), { dataTransfer: { files: [good] } })
    await user.click(screen.getByRole('button', { name: 'Upload 2 files' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('b.pdf: Upload failed.')
    expect(screen.getByRole('heading', { name: 'Ready to upload (1)' })).toBeInTheDocument()
    expect(screen.getByLabelText('Label for b.pdf')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'a.pdf' })).toBeInTheDocument()
  })

  it('refuses files over 10 MB without uploading, and deletes after confirming', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const { user, service } = renderWith(<MaterialsSection courseId="c1" caseId="k1" />, {
      listMaterials: vi.fn().mockResolvedValue([factPattern]),
    })
    await screen.findByRole('link', { name: 'Fact pattern.pdf' })

    const huge = new File(['x'], 'huge.pdf')
    Object.defineProperty(huge, 'size', { value: 100 * 1024 * 1024 + 1 })
    fireEvent.change(screen.getByTestId('material-input'), { target: { files: [huge] } })
    expect(await screen.findByRole('alert')).toHaveTextContent('huge.pdf: That file is too large.')
    expect(screen.queryByRole('heading', { name: /Ready to upload/ })).not.toBeInTheDocument()
    expect(service.uploadMaterial).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Delete Fact pattern.pdf' }))
    expect(service.deleteMaterial).toHaveBeenCalledWith('c1', 'k1', 'm1')
    expect(screen.queryByRole('link', { name: 'Fact pattern.pdf' })).not.toBeInTheDocument()
  })
})

describe('MaterialsSection sharing', () => {
  const teams = {
    teams: [
      { id: 't1', number: 1, members: [] },
      { id: 't2', number: 2, members: [] },
    ],
    unpaired: [],
    matchups: [{ id: 'w1', number: 1, plaintiffTeamId: 't1', defenseTeamId: 't2' }],
  }

  it('shares a file with chosen worlds and teams, keeping it to instructors otherwise', async () => {
    const log: CaseMaterial = { ...factPattern, id: 'm2', filename: 'Inspection log.pdf', description: '', audience: 'plaintiff' }
    const updateMaterial = vi.fn().mockResolvedValue({ ...log, audience: 'instructor' })
    const setMaterialShares = vi.fn().mockResolvedValue({ ...log, audience: 'instructor', shares: { matchupIds: ['w1'], teamIds: ['t2'] } })
    const { user } = renderWith(<MaterialsSection courseId="c1" caseId="k1" />, {
      listMaterials: vi.fn().mockResolvedValue([log]),
      listTeams: vi.fn().mockResolvedValue(teams),
      updateMaterial,
      setMaterialShares,
    })

    const select = await screen.findByLabelText('Who can see Inspection log.pdf')
    await screen.findByRole('option', { name: 'Specific worlds or teams…' })
    await user.selectOptions(select, 'Specific worlds or teams…')
    expect(updateMaterial).toHaveBeenCalledWith('c1', 'k1', 'm2', { audience: 'instructor', description: '' })

    const picker = screen.getByRole('group', { name: 'Also share Inspection log.pdf with' })
    await user.click(within(picker).getByRole('checkbox', { name: 'World A: Team 1 v. Team 2' }))
    await user.click(within(picker).getByRole('checkbox', { name: 'Team 2' }))
    await user.click(within(picker).getByRole('button', { name: 'Save sharing' }))

    expect(setMaterialShares).toHaveBeenCalledWith('c1', 'k1', 'm2', { matchupIds: ['w1'], teamIds: ['t2'] })
    expect(await screen.findByText('Also World A, Team 2')).toBeInTheDocument()
    expect(screen.queryByRole('group', { name: /Also share/ })).not.toBeInTheDocument()
  })
})

describe('InvestigatorSection', () => {
  const coaster: CourseCase = {
    id: 'k1',
    title: 'Rivera v. Thrill Park',
    summary: '',
    status: 'draft',
    phase: 'subpoena',
    instructorNote: '',
    inWorldDate: null,
    disputedIssues: '',
    importantFacts: { plaintiff: [], defense: [] },
    investigator: { enabled: true, name: 'John Hastings', instructions: '' },
    createdAt: '2026-10-01T15:00:00.000Z',
    updatedAt: '2026-10-01T15:00:00.000Z',
  }

  it('renames the investigator, gives him instructions, or turns him off', async () => {
    const saved = { ...coaster, investigator: { enabled: true, name: 'Nora Vance', instructions: 'Be brief.' } }
    const saveInvestigator = vi.fn().mockResolvedValue(saved)
    const onSaved = vi.fn()
    const { user } = renderWith(<InvestigatorSection courseId="c1" courseCase={coaster} onSaved={onSaved} />, { saveInvestigator })

    const toggle = screen.getByRole('checkbox', { name: 'Use a background investigator' })
    expect(toggle).toBeChecked()
    const save = screen.getByRole('button', { name: 'Save investigator' })
    expect(save).toBeDisabled()
    await user.clear(screen.getByLabelText('Name'))
    await user.type(screen.getByLabelText('Name'), 'Nora Vance')
    await user.type(screen.getByLabelText(/Instructions for the investigator/), 'Be brief.')
    await user.click(save)

    expect(saveInvestigator).toHaveBeenCalledWith('c1', 'k1', { enabled: true, name: 'Nora Vance', instructions: 'Be brief.' })
    expect(onSaved).toHaveBeenCalledWith(saved)
    expect(await screen.findByText('Saved.')).toBeInTheDocument()

    await user.click(toggle)
    expect(screen.getByLabelText('Name')).toBeDisabled()
  })

  it('shows why he can\'t be turned off', async () => {
    const saveInvestigator = vi.fn().mockRejectedValue(new Error('Move the case out of the investigate phase before turning off the investigator.'))
    const { user } = renderWith(<InvestigatorSection courseId="c1" courseCase={coaster} onSaved={vi.fn()} />, { saveInvestigator })

    await user.click(screen.getByRole('checkbox', { name: 'Use a background investigator' }))
    await user.click(screen.getByRole('button', { name: 'Save investigator' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Move the case out of the investigate phase')
  })
})

describe('WitnessesSection', () => {
  const coaster: CourseCase = {
    id: 'k1',
    title: 'Rivera v. Thrill Park',
    summary: '',
    status: 'draft',
    phase: 'subpoena',
    instructorNote: '',
    inWorldDate: null,
    disputedIssues: '',
    importantFacts: { plaintiff: ['The light was red.'], defense: ['It passed inspection.'] },
    createdAt: '2026-10-01T15:00:00.000Z',
    updatedAt: '2026-10-01T15:00:00.000Z',
  }
  const deposition: CaseMaterial = { ...factPattern, id: 'm2', audience: 'instructor', filename: 'Torres deposition.pdf', description: '' }
  const blankAi = { alignedSide: null, personaNotes: '', depositionMaterialId: null, knownMaterialIds: [], defendingCounsel: '' }
  const renderSection = (overrides: Partial<CourseService> = {}, onCaseChange = vi.fn()) =>
    renderWith(
      <MemoryRouter>
        <WitnessesSection courseId="c1" courseCase={coaster} onCaseChange={onCaseChange} />
      </MemoryRouter>,
      { listMaterials: vi.fn().mockResolvedValue([factPattern, deposition]), ...overrides },
    )

  it('adds, edits, and removes witnesses', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const elena = { id: 'w1', name: 'Elena Torres', role: 'Ride operator', description: '', audience: 'all' as const, ...blankAi }
    const createWitness = vi.fn().mockResolvedValue(elena)
    const updateWitness = vi.fn().mockResolvedValue({ ...elena, audience: 'defense' })
    const { user, service } = renderSection({ createWitness, updateWitness })

    await user.click(await screen.findByRole('button', { name: 'Add witness' }))
    const form = screen.getByRole('form', { name: 'New witness' })
    await user.type(within(form).getByLabelText('Name'), 'Elena Torres')
    await user.type(within(form).getByLabelText('Role'), 'Ride operator')
    await user.click(within(form).getByRole('button', { name: 'Save witness' }))
    expect(createWitness).toHaveBeenCalledWith('c1', 'k1', {
      name: 'Elena Torres',
      role: 'Ride operator',
      description: '',
      audience: 'all',
      ...blankAi,
      avatarPreset: null,
    })
    const item = await screen.findByRole('listitem', { name: 'Elena Torres' })
    expect(item).toHaveTextContent('Everyone')
    expect(within(item).queryByRole('link', { name: 'Test as plaintiff' })).not.toBeInTheDocument()

    await user.click(within(item).getByRole('button', { name: 'Edit' }))
    await user.selectOptions(screen.getByLabelText('Visible to'), 'Defense only')
    await user.click(screen.getByRole('button', { name: 'Save witness' }))
    expect(updateWitness).toHaveBeenCalledWith('c1', 'k1', 'w1', expect.objectContaining({ audience: 'defense' }))
    expect(await screen.findByRole('listitem', { name: 'Elena Torres' })).toHaveTextContent('Defense only')

    await user.click(within(screen.getByRole('listitem', { name: 'Elena Torres' })).getByRole('button', { name: 'Remove' }))
    expect(service.deleteWitness).toHaveBeenCalledWith('c1', 'k1', 'w1')
    expect(screen.getByText('No witnesses yet.')).toBeInTheDocument()
  })

  it('gives the witness one of the picture designs', async () => {
    const elena = { id: 'w1', name: 'Elena Torres', role: '', description: '', audience: 'all' as const, ...blankAi, avatarPreset: 4, avatarUrl: '/witness-avatars/04.svg' }
    const createWitness = vi.fn().mockResolvedValue(elena)
    const { user } = renderSection({ createWitness })

    await user.click(await screen.findByRole('button', { name: 'Add witness' }))
    const form = screen.getByRole('form', { name: 'New witness' })
    expect(within(form).getByRole('radio', { name: 'No picture' })).toBeChecked()
    await user.type(within(form).getByLabelText('Name'), 'Elena Torres')
    await user.click(within(form).getByRole('radio', { name: 'Picture 4' }))
    await user.click(within(form).getByRole('button', { name: 'Save witness' }))

    expect(createWitness).toHaveBeenCalledWith('c1', 'k1', expect.objectContaining({ avatarPreset: 4 }))
    const item = await screen.findByRole('listitem', { name: 'Elena Torres' })
    expect(item.querySelector('img')).toHaveAttribute('src', '/witness-avatars/04.svg')
  })

  it('uploads a cropped picture for the witness once it is saved', async () => {
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:picture'), revokeObjectURL: vi.fn() }))
    const elena = { id: 'w1', name: 'Elena Torres', role: '', description: '', audience: 'all' as const, ...blankAi, avatarPreset: null, avatarUrl: null }
    const withPicture = { ...elena, avatarUrl: '/api/witnesses/w1/avatar?v=1' }
    const createWitness = vi.fn().mockResolvedValue(elena)
    const uploadWitnessAvatar = vi.fn().mockResolvedValue(withPicture)
    const { user } = renderSection({ createWitness, uploadWitnessAvatar })

    await user.click(await screen.findByRole('button', { name: 'Add witness' }))
    const form = screen.getByRole('form', { name: 'New witness' })
    await user.type(within(form).getByLabelText('Name'), 'Elena Torres')
    await user.upload(within(form).getByLabelText('Upload a picture'), new File(['photo'], 'elena.png', { type: 'image/png' }))
    const preview = within(form).getByRole('img', { name: 'Your new picture' })
    Object.defineProperties(preview, { naturalWidth: { value: 400 }, naturalHeight: { value: 400 } })
    fireEvent.load(preview)
    await user.click(within(form).getByRole('button', { name: 'Use this picture' }))
    // Cropping is async, so wait for the picture to be picked.
    expect(await within(form).findByRole('radio', { name: 'Uploaded picture' })).toBeChecked()
    await user.click(within(form).getByRole('button', { name: 'Save witness' }))

    expect(createWitness).toHaveBeenCalledWith('c1', 'k1', expect.objectContaining({ avatarPreset: null }))
    expect(uploadWitnessAvatar).toHaveBeenCalledWith('c1', 'k1', 'w1', expect.any(Blob))
    const item = await screen.findByRole('listitem', { name: 'Elena Torres' })
    expect(item.querySelector('img')).toHaveAttribute('src', '/api/witnesses/w1/avatar?v=1')
    vi.unstubAllGlobals()
  })

  it('removes an uploaded picture when No picture is chosen', async () => {
    const elena = { id: 'w1', name: 'Elena Torres', role: '', description: '', audience: 'all' as const, ...blankAi, avatarPreset: null, avatarUrl: '/api/witnesses/w1/avatar?v=1' }
    const updateWitness = vi.fn().mockResolvedValue(elena)
    const removeWitnessAvatar = vi.fn().mockResolvedValue({ ...elena, avatarUrl: null })
    const { user } = renderSection({ listWitnesses: vi.fn().mockResolvedValue([elena]), updateWitness, removeWitnessAvatar })

    await user.click(within(await screen.findByRole('listitem', { name: 'Elena Torres' })).getByRole('button', { name: 'Edit' }))
    expect(screen.getByRole('radio', { name: 'Uploaded picture' })).toBeChecked()
    await user.click(screen.getByRole('radio', { name: 'No picture' }))
    await user.click(screen.getByRole('button', { name: 'Save witness' }))

    expect(removeWitnessAvatar).toHaveBeenCalledWith('c1', 'k1', 'w1')
    const item = await screen.findByRole('listitem', { name: 'Elena Torres' })
    expect(item.querySelector('img')).toBeNull()
  })

  it('sets up an AI witness from its deposition and the files it has seen', async () => {
    const created = {
      id: 'w1',
      name: 'Elena Torres',
      role: '',
      description: '',
      audience: 'all' as const,
      alignedSide: 'defense' as const,
      personaNotes: 'Plain-spoken.',
      depositionMaterialId: 'm2',
      knownMaterialIds: ['m1'],
      defendingCounsel: 'Ms. Park',
    }
    const createWitness = vi.fn().mockResolvedValue(created)
    const { user } = renderSection({ createWitness })

    await user.click(await screen.findByRole('button', { name: 'Add witness' }))
    const form = screen.getByRole('form', { name: 'New witness' })
    await user.type(within(form).getByLabelText('Name'), 'Elena Torres')
    await user.selectOptions(within(form).getByLabelText('Testifies for'), 'Defense')
    await user.selectOptions(within(form).getByLabelText('Interview file'), 'Torres deposition.pdf')
    await user.click(within(form).getByRole('checkbox', { name: 'Read first. (Fact pattern.pdf)' }))
    await user.type(within(form).getByLabelText(/Witness.s lawyer/), 'Ms. Park')
    await user.type(within(form).getByLabelText('Background and demeanor (optional)'), 'Plain-spoken.')
    await user.click(within(form).getByRole('button', { name: 'Save witness' }))

    expect(createWitness).toHaveBeenCalledWith('c1', 'k1', expect.objectContaining({
      alignedSide: 'defense',
      depositionMaterialId: 'm2',
      knownMaterialIds: ['m1'],
      defendingCounsel: 'Ms. Park',
      personaNotes: 'Plain-spoken.',
    }))
    const item = await screen.findByRole('listitem', { name: 'Elena Torres' })
    expect(item).toHaveTextContent('AI witness')
    expect(item).toHaveTextContent('For the defendant · Deposition: Torres deposition.pdf · 1 other file seen · Lawyer: Ms. Park')
    expect(within(item).getByRole('link', { name: 'Test as plaintiff' })).toHaveAttribute('href', '/courses/c1/cases/k1/witnesses/w1?side=plaintiff')
    expect(within(item).getByRole('link', { name: 'Test as defense' })).toHaveAttribute('href', '/courses/c1/cases/k1/witnesses/w1?side=defense')
  })

  it('saves the case date and disputed issues', async () => {
    const saved = { ...coaster, inWorldDate: '2024-10-01', disputedIssues: 'Where she stood.' }
    const saveWitnessSettings = vi.fn().mockResolvedValue(saved)
    const onCaseChange = vi.fn()
    const { user } = renderSection({ saveWitnessSettings }, onCaseChange)

    const form = await screen.findByRole('form', { name: 'AI witness settings' })
    fireEvent.change(within(form).getByLabelText(/Today.s date in the case/), { target: { value: '2024-10-01' } })
    await user.type(within(form).getByLabelText(/Issues the witnesses/), 'Where she stood.')
    await user.click(within(form).getByRole('button', { name: 'Save settings' }))
    expect(saveWitnessSettings).toHaveBeenCalledWith('c1', 'k1', { inWorldDate: '2024-10-01', disputedIssues: 'Where she stood.' })
    expect(onCaseChange).toHaveBeenCalledWith(saved)
  })
})

describe('TasksSection', () => {
  it('adds a task with a due date and lists it', async () => {
    const task = {
      id: 't1',
      title: 'Outline the deposition',
      description: '',
      dueAt: '2026-11-01T23:59:00.000Z',
      audience: 'plaintiff' as const,
    }
    const listTasks = vi.fn().mockResolvedValueOnce([]).mockResolvedValue([task])
    const createTask = vi.fn().mockResolvedValue(task)
    const { user } = renderWith(<TasksSection courseId="c1" caseId="k1" />, { listTasks, createTask })

    await user.click(await screen.findByRole('button', { name: 'Add task' }))
    const form = screen.getByRole('form', { name: 'New task' })
    await user.type(within(form).getByLabelText('Title'), 'Outline the deposition')
    fireEvent.change(within(form).getByLabelText(/Due/), { target: { value: '2026-11-01T18:59' } })
    await user.selectOptions(within(form).getByLabelText('Visible to'), 'Plaintiff only')
    await user.click(within(form).getByRole('button', { name: 'Save task' }))

    expect(createTask).toHaveBeenCalledWith('c1', 'k1', {
      title: 'Outline the deposition',
      description: '',
      dueAt: new Date('2026-11-01T18:59').toISOString(),
      audience: 'plaintiff',
    })
    const item = await screen.findByRole('listitem', { name: 'Outline the deposition' })
    expect(item).toHaveTextContent('Plaintiff only')
    expect(item).toHaveTextContent('Due ')
  })
})

describe('StudentViewSection', () => {
  const workspace: CaseWorkspace = {
    case: { id: 'k1', title: 'Rivera v. Thrill Park', summary: '', status: 'draft', phase: 'subpoena', instructorNote: '' },
    team: null,
    world: null,
    side: 'plaintiff',
    materials: [],
    witnesses: [],
    investigatorAvailable: false,
    tasks: [],
    preview: true,
  }

  it("offers each world's teams and previews the chosen one read-only", async () => {
    const previewWorkspace = vi.fn().mockResolvedValue(workspace)
    const { user } = renderWith(<StudentViewSection courseId="c1" caseId="k1" />, {
      listTeams: vi.fn().mockResolvedValue({
        teams: [
          { id: 't1', number: 1, members: [] },
          { id: 't2', number: 2, members: [] },
        ],
        unpaired: [],
        matchups: [{ id: 'm1', number: 1, plaintiffTeamId: 't2', defenseTeamId: 't1' }],
      }),
      previewWorkspace,
    })

    const picker = await screen.findByLabelText('View as')
    expect(within(picker).getAllByRole('option').map((o) => o.textContent)).toEqual([
      'World A · Plaintiff (Team 2)',
      'World A · Defendant (Team 1)',
      'Any plaintiff team',
      'Any defense team',
    ])
    // The preview loads after the teams do, so wait for it.
    await waitFor(() => expect(previewWorkspace).toHaveBeenCalledWith('c1', 'k1', 'plaintiff', 'm1'))
    expect(await screen.findByText('Not launched yet')).toBeInTheDocument()

    await user.selectOptions(picker, 'Any defense team')
    await waitFor(() => expect(previewWorkspace).toHaveBeenLastCalledWith('c1', 'k1', 'defense', null))
  })
})
