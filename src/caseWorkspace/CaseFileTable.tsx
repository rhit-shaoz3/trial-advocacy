import { Download } from 'lucide-react'
import { SortHeader } from '../components/SortHeader'
import { byText, useSort, type SortState } from '../components/sorting'
import { AUDIENCE_LABEL, fileCategory, fileTypeLabel, formatSize, shortDate } from '../courses/caseLabels'
import type { CaseMaterial } from '../courses/types'
import { CATEGORY_ICON } from './categoryIcons'

/** Who can see a file, as the team reads it: a team only sees an instructors-only file once it's shared with them. */
const visibleTo = (m: CaseMaterial) => (m.audience === 'instructor' ? 'Shared with your team' : AUDIENCE_LABEL[m.audience])

type SortKey = 'file' | 'type' | 'audience' | 'added'

const SORTS: Record<SortKey, { label: string; first: 1 | -1; compare(a: CaseMaterial, b: CaseMaterial): number }> = {
  file: { label: 'File', first: 1, compare: (a, b) => byText(a.filename, b.filename) },
  type: { label: 'Type', first: 1, compare: (a, b) => byText(fileTypeLabel(a.contentType), fileTypeLabel(b.contentType)) },
  audience: { label: 'Visible to', first: 1, compare: (a, b) => byText(visibleTo(a), visibleTo(b)) },
  // Words sort A to Z first; dates newest first.
  added: { label: 'Added', first: -1, compare: (a, b) => a.uploadedAt.localeCompare(b.uploadedAt) },
}
const FIRST = Object.fromEntries(Object.entries(SORTS).map(([k, s]) => [k, s.first])) as Record<SortKey, 1 | -1>

/** The initial file first, then the rest by the chosen column (ties by file name). */
function sortFiles(list: CaseMaterial[], sort: SortState<SortKey>) {
  return [...list].sort(
    (a, b) => Number(b.initial) - Number(a.initial) || sort.dir * SORTS[sort.key].compare(a, b) || byText(a.filename, b.filename),
  )
}

/**
 * The team's case files as a table: the initial file first, then the rest by
 * file name, or by the column heading clicked. A file's name opens it in the
 * viewer; the icon at the end downloads it.
 */
export function CaseFileTable({
  materials,
  downloadUrl,
  now,
  onOpen,
}: {
  materials: CaseMaterial[]
  downloadUrl(id: string): string
  now: Date
  onOpen(material: CaseMaterial): void
}) {
  const [sort, sortBy] = useSort<SortKey>('file', FIRST)
  return (
    <div className="cw-table-scroll">
      <table className="cw-table">
        <thead>
          <tr>
            {(Object.keys(SORTS) as SortKey[]).map((key) => (
              <SortHeader
                key={key}
                column={key}
                label={SORTS[key].label}
                sort={sort}
                onSort={sortBy}
                className={key === 'type' || key === 'audience' ? 'cw-table-wide' : undefined}
              />
            ))}
            <th scope="col">
              <span className="visually-hidden">Download</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {sortFiles(materials, sort).map((m) => {
            const Icon = CATEGORY_ICON[fileCategory(m.contentType)]
            return (
              <tr key={m.id}>
                <td>
                  <button type="button" className="cw-file-open" onClick={() => onOpen(m)} title={`Open ${m.filename} in the viewer`}>
                    <span className="ws-icon-tile ws-icon-tile-sm ws-tone-blue" aria-hidden="true">
                      <Icon />
                    </span>
                    <span className="cw-row-body">
                      <strong>{m.filename}</strong>
                      <small>
                        {formatSize(m.sizeBytes)}
                        {/* On a phone, the type and audience columns fold in here. */}
                        <span className="cw-table-narrow">
                          {' '}
                          · {fileTypeLabel(m.contentType)} · {visibleTo(m)}
                        </span>
                      </small>
                      {m.description && <span className="cw-row-desc">{m.description}</span>}
                      {m.initial && <span className="cw-badge cw-table-start">Start here</span>}
                    </span>
                  </button>
                </td>
                <td className="cw-table-wide">{fileTypeLabel(m.contentType)}</td>
                <td className="cw-table-wide">{visibleTo(m)}</td>
                <td>{shortDate(m.uploadedAt, now)}</td>
                <td className="cw-table-download">
                  <a href={downloadUrl(m.id)} download className="cw-file-download" aria-label={`Download ${m.filename}`} title="Download">
                    <Download aria-hidden="true" />
                  </a>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
