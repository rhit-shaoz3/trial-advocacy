import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { pagesText, parsePages } from '../../courses/exhibitLabels'
import type { Exhibit, ExhibitList, StudentExhibits } from '../../courses/types'
import { ExhibitListSection } from './ExhibitListSection'

const emptyList = (side: 'plaintiff' | 'defense'): ExhibitList => ({ side, items: [], updatedAt: null, submittedAt: null, submittedBy: null })

const base: StudentExhibits = {
  side: 'plaintiff',
  options: [
    { kind: 'material', id: 'm1', title: 'Amended complaint.pdf', group: 'case-file', contentType: 'application/pdf', markable: 'pdf' },
    { kind: 'material', id: 'm2', title: 'Ride inspection log', group: 'investigator', contentType: 'application/pdf', markable: 'pdf' },
    {
      kind: 'material',
      id: 't1',
      title: 'Operator interview notes.docx',
      group: 'investigator',
      contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      parts: [
        { n: 0, text: 'The operator skipped the checklist.' },
        { n: 1, text: 'The park changed vendors in May.' },
      ],
    },
    {
      kind: 'deposition',
      id: 'i1',
      title: 'Deposition of Tom Becker (Oct 1)',
      group: 'depositions',
      parts: [{ n: 0, question: 'What did you see?', text: 'The light was red.', objection: null }],
    },
  ],
  mine: emptyList('plaintiff'),
  theirs: emptyList('defense'),
  exhibits: [],
  finalizedAt: null,
  notices: { exchanged: false, objections: 0, rulings: 0, finalized: false },
}

const exhibit = (over: Partial<Exhibit>): Exhibit => ({
  id: 'x1',
  offeredBy: 'defense',
  joint: false,
  position: 0,
  kind: 'material',
  sourceId: 'm9',
  parts: null,
  title: 'Incident report.pdf',
  excerpt: null,
  contentType: 'application/pdf',
  status: 'awaiting_authenticity',
  authenticated: false,
  authenticityNote: null,
  authenticityRuling: null,
  authenticityRulingNote: null,
  objection: null,
  response: null,
  acceptsRedaction: null,
  ruling: null,
  rulingNote: null,
  redaction: null,
  supersededBy: null,
  label: null,
  updatedAt: '2026-11-02T10:00:00Z',
  ruledAt: null,
  ...over,
})

const exchanged = (exhibits: Exhibit[], side: 'plaintiff' | 'defense' = 'plaintiff'): StudentExhibits => ({
  ...base,
  side,
  mine: { ...emptyList(side), submittedAt: '2026-11-01T10:00:00Z' },
  theirs: { ...emptyList(side === 'plaintiff' ? 'defense' : 'plaintiff'), submittedAt: '2026-11-01T11:00:00Z' },
  exhibits,
})

function renderSection(exhibits: StudentExhibits, actions = true) {
  const onSave = vi.fn().mockResolvedValue(undefined)
  const onSubmit = vi.fn().mockResolvedValue(undefined)
  const onMove = vi.fn().mockResolvedValue(undefined)
  const onOpenFile = vi.fn()
  const onOpenExhibit = vi.fn()
  const user = userEvent.setup()
  render(
    <ExhibitListSection
      exhibits={exhibits}
      onSave={actions ? onSave : undefined}
      onSubmit={actions ? onSubmit : undefined}
      onMove={actions ? onMove : undefined}
      onOpenFile={onOpenFile}
      onOpenExhibit={onOpenExhibit}
    />,
  )
  return { user, onSave, onSubmit, onMove, onOpenFile, onOpenExhibit }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('pages', () => {
  it('reads and writes page ranges', () => {
    expect(parsePages('3-5, 9')).toEqual([3, 4, 5, 9])
    expect(parsePages('2–3,2')).toEqual([2, 3])
    expect(parsePages('a')).toBeNull()
    expect(parsePages('5-2')).toBeNull()
    expect(pagesText([3, 4, 5, 9])).toBe('3–5, 9')
  })
})

describe('building the list', () => {
  it('warns that what isn’t listed can’t be used, and groups what the team can list', () => {
    renderSection(base)
    expect(screen.getByRole('note')).toHaveTextContent('If it isn’t on your list, you can’t use it at trial.')
    expect(screen.getByRole('group', { name: 'Case file' })).toHaveTextContent('Amended complaint.pdf')
    expect(screen.getByRole('group', { name: 'From your investigator' })).toHaveTextContent('Ride inspection log')
    expect(screen.getByRole('group', { name: 'From your investigator' })).toHaveTextContent('Operator interview notes.docx')
    expect(screen.getByRole('group', { name: 'Your depositions' })).toHaveTextContent('Deposition of Tom Becker')
    expect(screen.getByRole('button', { name: 'Teach me' })).toBeInTheDocument()
  })

  it('opens the exhibit-list guide from the lightbulb at the top left of its card', async () => {
    const { user } = renderSection(base)
    const header = screen.getByRole('heading', { name: 'Build your exhibit list for trial' }).closest('header')!
    const teach = within(header).getByRole('button', { name: 'Teach me' })
    expect(header.firstElementChild).toBe(teach)
    await user.click(teach)
    expect(await screen.findByRole('dialog', { name: 'What is an exhibit list?' })).toBeInTheDocument()
  })

  it('saves a draft with whole items, a PDF’s chosen pages, and a text file’s chosen paragraphs', async () => {
    const { user, onSave, onOpenFile } = renderSection(base)
    await user.click(screen.getByRole('button', { name: 'View Amended complaint.pdf' }))
    expect(onOpenFile).toHaveBeenCalledWith('m1')

    await user.click(screen.getByRole('checkbox', { name: 'Amended complaint.pdf' }))
    await user.click(within(screen.getByRole('radiogroup', { name: 'How much of Amended complaint.pdf' })).getByRole('radio', { name: 'Only some pages' }))
    await user.type(screen.getByRole('textbox', { name: 'Pages of Amended complaint.pdf' }), '2-3')

    await user.click(screen.getByRole('checkbox', { name: 'Operator interview notes.docx' }))
    await user.click(screen.getByRole('radio', { name: 'Only some paragraphs' }))
    await user.click(screen.getByRole('checkbox', { name: /The park changed vendors/ }))

    await user.click(screen.getByRole('checkbox', { name: 'Deposition of Tom Becker (Oct 1)' }))
    await user.click(screen.getByRole('button', { name: 'Save draft' }))
    expect(onSave).toHaveBeenCalledWith([
      { kind: 'material', id: 'm1', parts: [2, 3] },
      { kind: 'material', id: 't1', parts: [1] },
      { kind: 'deposition', id: 'i1', parts: null },
    ])
    expect(await screen.findByText('Draft saved')).toBeInTheDocument()
  })

  it('asks for pages it can read, and confirms before submitting for good', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    const { user, onSubmit } = renderSection(base)
    await user.click(screen.getByRole('checkbox', { name: 'Amended complaint.pdf' }))
    await user.click(screen.getByRole('radio', { name: 'Only some pages' }))
    await user.type(screen.getByRole('textbox', { name: 'Pages of Amended complaint.pdf' }), 'the good part')
    await user.click(screen.getByRole('button', { name: /Submit list/ }))
    expect(screen.getByRole('alert')).toHaveTextContent('Write the pages of Amended complaint.pdf like “3–5, 9”.')

    await user.click(screen.getByRole('radio', { name: 'Whole file' }))
    await user.click(screen.getByRole('button', { name: /Submit list/ }))
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining("anything not on it can't be used at trial"))
    expect(onSubmit).not.toHaveBeenCalled()
    confirm.mockReturnValue(true)
    await user.click(screen.getByRole('button', { name: /Submit list/ }))
    expect(onSubmit).toHaveBeenCalledWith([{ kind: 'material', id: 'm1', parts: null }])
  })

  it('blacks out parts of a PDF it lists, with the copy, and saves them; changing the pages undoes it', async () => {
    const copyActions = { loadFile: vi.fn(), upload: vi.fn() }
    const onSave = vi.fn().mockResolvedValue(undefined)
    const user = userEvent.setup()
    render(
      <ExhibitListSection
        exhibits={{
          ...base,
          mine: {
            ...emptyList('plaintiff'),
            updatedAt: '2026-11-01T10:00:00Z',
            items: [
              {
                kind: 'material',
                id: 'm1',
                parts: [2],
                marks: { mode: 'redact', pages: [{ page: 1, removed: false, boxes: [{ x: 0, y: 0, w: 0.5, h: 0.5 }] }] },
                redactedKey: 'cases/k/copy',
                title: 'Amended complaint.pdf — page 2 (with redactions)',
              },
            ],
          },
        }}
        onSave={onSave}
        onSubmit={vi.fn()}
        onOpenFile={vi.fn()}
        onOpenExhibit={vi.fn()}
        copyActions={copyActions}
      />,
    )
    // Unchecked files offer nothing yet; the listed PDF shows its black-outs.
    expect(screen.queryAllByRole('button', { name: 'Black out parts' })).toHaveLength(0)
    expect(screen.getByText(/Parts blacked out/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Save draft' }))
    expect(onSave).toHaveBeenLastCalledWith([
      {
        kind: 'material',
        id: 'm1',
        parts: [2],
        marks: { mode: 'redact', pages: [{ page: 1, removed: false, boxes: [{ x: 0, y: 0, w: 0.5, h: 0.5 }] }] },
        redactedKey: 'cases/k/copy',
      },
    ])

    // New pages need new black-outs.
    await user.type(screen.getByRole('textbox', { name: 'Pages of Amended complaint.pdf' }), ', 4')
    expect(screen.queryByText(/Parts blacked out/)).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Black out parts' }))
    expect(screen.getByRole('dialog')).toHaveTextContent('Your exhibit · Amended complaint.pdf')
    expect(within(screen.getByRole('dialog')).getByRole('radio', { name: 'Mark what to black out' })).toBeInTheDocument()
    expect(copyActions.loadFile).toHaveBeenCalledWith('m1')
  })

  it('shows the submitted list while waiting for the other side', () => {
    renderSection({
      ...base,
      mine: { ...emptyList('plaintiff'), submittedAt: '2026-11-01T10:00:00Z', submittedBy: 'Ada Lawyer', items: [{ kind: 'material', id: 'm1', parts: null, title: 'Amended complaint.pdf' }] },
    })
    expect(screen.getByRole('status')).toHaveTextContent('Submitted by Ada Lawyer. Waiting for the defense to submit theirs')
    expect(screen.queryByRole('button', { name: /Submit list/ })).not.toBeInTheDocument()
  })
})

describe('after the exchange', () => {
  it('explains the order, and asks for authenticity before admission', async () => {
    const { user, onMove } = renderSection(exchanged([exhibit({}), exhibit({ id: 'x2', title: 'Waiver.pdf', status: 'awaiting_admission', authenticated: true })]))
    expect(screen.getByText('Authenticity first.')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '2 exhibits need your team' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Agree to authenticity' }))
    expect(onMove).toHaveBeenCalledWith('x1', { step: 'authenticity', decision: 'agree' })

    await user.click(screen.getByRole('button', { name: 'Challenge admission' }))
    await user.type(screen.getByRole('textbox', { name: /Your objection/ }), 'Hearsay; redact page 2.')
    await user.click(screen.getByRole('button', { name: 'Send objection' }))
    expect(onMove).toHaveBeenCalledWith('x2', { step: 'admission', decision: 'challenge', objection: 'Hearsay; redact page 2.' })
  })

  it('moves an exhibit the team authenticates straight on to its admission decision', async () => {
    const before = exchanged([exhibit({}), exhibit({ id: 'x2', title: 'Waiver.pdf' })])
    const onMove = vi.fn().mockResolvedValue(undefined)
    const user = userEvent.setup()
    const props = { onMove, onOpenFile: vi.fn(), onOpenExhibit: vi.fn() }
    const { rerender } = render(<ExhibitListSection exhibits={before} {...props} />)
    const step = (name: RegExp) => screen.getByRole('group', { name })
    expect(step(/Step 1 · Authenticity/)).toHaveTextContent('Incident report.pdf')
    expect(screen.queryByRole('group', { name: /Step 2/ })).not.toBeInTheDocument()

    await user.click(within(step(/Step 1/)).getAllByRole('button', { name: 'Agree to authenticity' })[0])
    // The other exhibit is still waiting on its authenticity, but this one can be decided now.
    rerender(
      <ExhibitListSection
        exhibits={exchanged([exhibit({ status: 'awaiting_admission', authenticated: true }), exhibit({ id: 'x2', title: 'Waiver.pdf' })])}
        {...props}
      />,
    )
    const admission = step(/Step 2 · Admission/)
    expect(admission).toHaveTextContent('Incident report.pdf')
    expect(admission).toHaveTextContent('Just authenticated: now decide on admission')
    expect(step(/Step 1 · Authenticity/)).toHaveTextContent('Waiver.pdf')
    const admit = within(admission).getByRole('button', { name: 'Admit' })
    expect(admit).toBeEnabled()
    await user.click(admit)
    expect(onMove).toHaveBeenLastCalledWith('x1', { step: 'admission', decision: 'admit' })
  })

  it('needs a reason to challenge authenticity', async () => {
    const { user, onMove } = renderSection(exchanged([exhibit({})]))
    await user.click(screen.getByRole('button', { name: 'Challenge authenticity' }))
    expect(screen.getByRole('button', { name: 'Send challenge to the judge' })).toBeDisabled()
    await user.type(screen.getByRole('textbox', { name: /Why isn’t it what it claims to be/ }), 'Unsigned.')
    await user.click(screen.getByRole('button', { name: 'Send challenge to the judge' }))
    expect(onMove).toHaveBeenCalledWith('x1', { step: 'authenticity', decision: 'challenge', note: 'Unsigned.' })
  })

  it('lets the team answer an objection to its own exhibit, or drop it', async () => {
    const objected = exhibit({ offeredBy: 'plaintiff', status: 'objection_response', authenticated: true, objection: 'Irrelevant.' })
    const { user, onMove } = renderSection(exchanged([objected]))
    expect(screen.getByText('Their objection:').parentElement).toHaveTextContent('Irrelevant.')

    await user.click(screen.getByRole('button', { name: 'Send to the judge' }))
    await user.type(screen.getByRole('textbox', { name: /Your response to the objection/ }), 'It shows notice.')
    await user.type(screen.getByRole('textbox', { name: /Would you accept a redaction/ }), 'Page 4')
    // The form's own button, below the one that opened it.
    await user.click(screen.getAllByRole('button', { name: 'Send to the judge' }).at(-1)!)
    expect(onMove).toHaveBeenCalledWith('x1', { step: 'response', decision: 'review', response: 'It shows notice.', acceptsRedaction: 'Page 4' })
  })

  it('sorts every exhibit by where it stands, with a badge for authentic ones', () => {
    renderSection(
      exchanged([
        exhibit({ id: 'a', title: 'Waiting.pdf' }),
        exhibit({ id: 'b', title: 'Checked.pdf', status: 'admission_review', authenticated: true }),
        exhibit({ id: 'c', title: 'In.pdf', status: 'admitted', authenticated: true, joint: true, offeredBy: 'plaintiff' }),
        exhibit({ id: 'd', title: 'Out.pdf', status: 'excluded', authenticated: true, ruling: 'sustained' }),
      ]),
      false,
    )
    const running = screen.getByRole('region', { name: 'Where every exhibit stands' })
    const group = (title: string) => within(running).getByRole('heading', { name: new RegExp(`^${title}`) }).parentElement!
    expect(group('In review')).toHaveTextContent('Waiting.pdf')
    expect(group('Authenticated')).toHaveTextContent('Checked.pdf')
    expect(group('Authenticated')).toHaveTextContent('Authentic')
    expect(group('Admitted')).toHaveTextContent('Joint · Plaintiff’sIn.pdf')
    expect(within(running).getByText('Not admitted (1)')).toBeInTheDocument()
    // Read-only: nothing to do.
    expect(screen.queryByRole('button', { name: 'Agree to authenticity' })).not.toBeInTheDocument()
  })

  it('shows the final list, numbered and lettered', () => {
    renderSection({
      ...exchanged([
        exhibit({ id: 'a', title: 'Complaint.pdf', status: 'admitted', joint: true, offeredBy: 'plaintiff', label: '1' }),
        exhibit({ id: 'b', title: 'Incident report.pdf', status: 'admitted', label: 'A', redaction: 'Page 2' }),
      ]),
      finalizedAt: '2026-11-02T12:00:00Z',
    })
    expect(screen.getByRole('heading', { name: 'The final exhibit list' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Plaintiff’s exhibits' }).parentElement).toHaveTextContent('P-1Complaint.pdfJoint')
    expect(screen.getByRole('heading', { name: 'Defense’s exhibits' }).parentElement).toHaveTextContent('D-AIncident report.pdfRedacted: Page 2')
  })

  it('opens a file exhibit as an exhibit, and redacted text with black bars', async () => {
    const { user, onOpenExhibit } = renderSection(
      exchanged([
        exhibit({ id: 'a', title: 'Incident report.pdf', status: 'admitted', redacted: true, ruling: 'partial' }),
        exhibit({
          id: 'b',
          kind: 'deposition',
          offeredBy: 'plaintiff',
          title: 'Deposition of Tom Becker (Oct 1)',
          status: 'admitted',
          redacted: true,
          ruling: 'partial',
          excerpt: [{ n: 1, question: 'And?', objection: null, text: 'The light ████████' }],
        }),
      ]),
      false,
    )
    const running = screen.getByRole('region', { name: 'Where every exhibit stands' })
    expect(within(running).getAllByText('Admitted, redacted')).toHaveLength(2)
    await user.click(within(running).getByRole('button', { name: 'Incident report.pdf' }))
    expect(onOpenExhibit).toHaveBeenCalledWith(expect.objectContaining({ id: 'a' }))

    await user.click(within(running).getByRole('button', { name: 'Deposition of Tom Becker (Oct 1)' }))
    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveTextContent('Deposition transcript · as admitted, redacted')
    expect(within(dialog).getByRole('img', { name: 'redacted' })).toHaveTextContent('████████')
  })
})
