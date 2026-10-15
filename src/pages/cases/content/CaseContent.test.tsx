import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CourseServiceContext } from '../../../courses/CourseServiceContext'
import type { CaseMaterial, CaseWorkspace, CourseService } from '../../../courses/types'
import { fakeCourseService } from '../../../test/fakeCourseService'
import { LaunchPanel } from './LaunchPanel'
import { MaterialsSection } from './MaterialsSection'
import { StudentViewSection } from './StudentViewSection'
import { TasksSection } from './TasksSection'
import { WitnessesSection } from './WitnessesSection'

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
    expect(onLaunched).toHaveBeenCalledWith(launched)
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

  it('uploads chosen files with the selected audience and description', async () => {
    const evidence = { ...factPattern, id: 'm2', filename: 'photo.jpg', contentType: 'image/jpeg' }
    const uploadMaterial = vi.fn().mockResolvedValue(evidence)
    const { user } = renderWith(<MaterialsSection courseId="c1" caseId="k1" />, { uploadMaterial })

    await screen.findByText(/No files uploaded yet/)
    await user.selectOptions(screen.getByLabelText('Visible to'), 'Defense only')
    await user.type(screen.getByLabelText(/Description/), 'Ride photo')
    const file = new File(['img'], 'photo.jpg', { type: 'image/jpeg' })
    fireEvent.change(screen.getByTestId('material-input'), { target: { files: [file] } })

    expect(await screen.findByRole('link', { name: 'photo.jpg' })).toBeInTheDocument()
    expect(uploadMaterial).toHaveBeenCalledWith('c1', 'k1', file, {
      audience: 'defense',
      description: 'Ride photo',
    })
  })

  it('refuses files over 10 MB without uploading, and deletes after confirming', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const { user, service } = renderWith(<MaterialsSection courseId="c1" caseId="k1" />, {
      listMaterials: vi.fn().mockResolvedValue([factPattern]),
    })
    await screen.findByRole('link', { name: 'Fact pattern.pdf' })

    const huge = new File(['x'], 'huge.pdf')
    Object.defineProperty(huge, 'size', { value: 10 * 1024 * 1024 + 1 })
    fireEvent.change(screen.getByTestId('material-input'), { target: { files: [huge] } })
    expect(await screen.findByRole('alert')).toHaveTextContent('huge.pdf: That file is too large.')
    expect(service.uploadMaterial).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Delete Fact pattern.pdf' }))
    expect(service.deleteMaterial).toHaveBeenCalledWith('c1', 'k1', 'm1')
    expect(screen.queryByRole('link', { name: 'Fact pattern.pdf' })).not.toBeInTheDocument()
  })
})

describe('WitnessesSection', () => {
  it('adds, edits, and removes witnesses', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const elena = { id: 'w1', name: 'Elena Torres', role: 'Ride operator', description: '', audience: 'all' as const }
    const createWitness = vi.fn().mockResolvedValue(elena)
    const updateWitness = vi.fn().mockResolvedValue({ ...elena, audience: 'defense' })
    const { user, service } = renderWith(<WitnessesSection courseId="c1" caseId="k1" />, {
      createWitness,
      updateWitness,
    })

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
    })
    const item = await screen.findByRole('listitem', { name: 'Elena Torres' })
    expect(item).toHaveTextContent('Everyone')

    await user.click(within(item).getByRole('button', { name: 'Edit' }))
    await user.selectOptions(screen.getByLabelText('Visible to'), 'Defense only')
    await user.click(screen.getByRole('button', { name: 'Save witness' }))
    expect(updateWitness).toHaveBeenCalledWith('c1', 'k1', 'w1', expect.objectContaining({ audience: 'defense' }))
    expect(await screen.findByRole('listitem', { name: 'Elena Torres' })).toHaveTextContent('Defense only')

    await user.click(within(screen.getByRole('listitem', { name: 'Elena Torres' })).getByRole('button', { name: 'Remove' }))
    expect(service.deleteWitness).toHaveBeenCalledWith('c1', 'k1', 'w1')
    expect(screen.getByText('No witnesses yet.')).toBeInTheDocument()
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
    case: { id: 'k1', title: 'Rivera v. Thrill Park', summary: '', status: 'draft', instructorNote: '' },
    team: null,
    world: null,
    side: 'plaintiff',
    materials: [],
    witnesses: [],
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
    expect(previewWorkspace).toHaveBeenCalledWith('c1', 'k1', 'plaintiff', 'm1')
    expect(await screen.findByText('Not launched yet')).toBeInTheDocument()

    await user.selectOptions(picker, 'Any defense team')
    expect(previewWorkspace).toHaveBeenLastCalledWith('c1', 'k1', 'defense', null)
  })
})
