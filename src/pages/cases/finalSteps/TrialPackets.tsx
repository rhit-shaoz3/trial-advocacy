import { useEffect, useState } from 'react'
import { AlertTriangle, Download, FileText, FolderArchive } from 'lucide-react'
import { PacketFolders } from '../../../caseWorkspace/finalSteps/PacketFolders'
import { Modal } from '../../../components/Modal'
import { useCourseService } from '../../../courses/CourseServiceContext'
import { EXHIBIT_SIDE } from '../../../courses/exhibitLabels'
import { worldLabel } from '../../../courses/worldLabel'
import type { PacketContents, TrialPacket } from '../../../courses/types'

const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

/** What a team's packet holds, in a line. */
function holds(p: TrialPacket) {
  return [
    count(p.depositions, 'deposition'),
    count(p.exhibits, 'exhibit for trial', 'exhibits for trial'),
    count(p.files, 'case file'),
    count(p.reports, 'investigator report'),
    count(p.discovery, 'discovery set'),
  ].join(' · ')
}

/** A team's single PDF as the team filed it: its folders and what's in each. */
function PacketPdfModal({ courseId, caseId, packet, onClose }: { courseId: string; caseId: string; packet: TrialPacket; onClose(): void }) {
  const service = useCourseService()
  const [contents, setContents] = useState<PacketContents | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    service
      .getTrialPacketContents(courseId, caseId, packet.teamId)
      .then((c) => !cancelled && setContents(c))
      .catch((err: Error) => !cancelled && setError(err.message))
    return () => {
      cancelled = true
    }
  }, [service, courseId, caseId, packet.teamId])

  return (
    <Modal eyebrow={`World ${worldLabel(packet.worldNumber)}`} title={`Team ${packet.teamNumber}’s PDF`} icon={<FileText aria-hidden="true" />} onClose={onClose}>
      <p className="muted">The team names its folders and files what it wants in each; anything it didn’t file isn’t in the PDF.</p>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {contents ? (
        <PacketFolders contents={contents} pdfUrl={service.trialPacketPdfUrl(courseId, caseId, packet.teamId)} />
      ) : (
        !error && <p className="muted">Loading…</p>
      )}
    </Modal>
  )
}

/**
 * Each team's own trial packet (the court binders above are for the trial),
 * to download as a zip or as the team's single PDF. It can be downloaded any time in final steps; what isn't
 * finished yet is pointed out here and in the packet. Teams get their own once
 * they submit their exhibit list.
 */
export function TrialPackets({ courseId, caseId }: { courseId: string; caseId: string }) {
  const service = useCourseService()
  const [packets, setPackets] = useState<TrialPacket[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [choosing, setChoosing] = useState<TrialPacket | null>(null)

  useEffect(() => {
    let cancelled = false
    service
      .listTrialPackets(courseId, caseId)
      .then((p) => !cancelled && setPackets(p))
      .catch((err: Error) => !cancelled && setError(err.message))
    return () => {
      cancelled = true
    }
  }, [service, courseId, caseId])

  const unfinished = packets?.filter((p) => p.warnings.length > 0).length ?? 0

  return (
    <section className="course-section tp-section" aria-labelledby="packets-heading">
      <div className="section-header">
        <div>
          <span className="ws-eyebrow">Each team’s own</span>
          <h2 id="packets-heading">Team packets</h2>
        </div>
        {packets && packets.length > 0 && (
          <a className="btn-primary tp-all" href={service.trialPacketsUrl(courseId, caseId)} download>
            <Download aria-hidden="true" /> Download all (.zip)
          </a>
        )}
      </div>
      <p className="muted">
        Each team’s packet has its exhibits for trial and the joint exhibit list, every deposition taken in its case world, and
        the case files, investigator reports, discovery, and ruled facts it gathered. Nothing from the other team’s private work
        is included. Teams can download their own once they submit their exhibit list, and arrange a single PDF for court
        in folders of their own. You can see and download that PDF too.
      </p>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {!packets ? (
        !error && <p className="muted">Loading…</p>
      ) : packets.length === 0 ? (
        <p className="muted">This case has no case worlds yet.</p>
      ) : (
        <>
          {unfinished > 0 && (
            <p className="xl-warning">
              <AlertTriangle aria-hidden="true" />
              <span>
                {count(unfinished, 'packet isn’t', 'packets aren’t')} finished yet. You can still download them; each one notes
                what’s missing.
              </span>
            </p>
          )}
          <ul className="tp-list">
            {packets.map((p) => (
              <li key={p.teamId} className="tp-row">
                <span className="ws-icon-tile ws-icon-tile-sm ws-tone-blue" aria-hidden="true">
                  <FolderArchive />
                </span>
                <div className="tp-row-text">
                  <strong>
                    World {worldLabel(p.worldNumber)} · Team {p.teamNumber} ({EXHIBIT_SIDE[p.side]})
                  </strong>
                  {p.members.length > 0 && <small>{p.members.join(', ')}</small>}
                  <small>{holds(p)}</small>
                  {p.warnings.map((w) => (
                    <small key={w} className="tp-warning">
                      {w}
                    </small>
                  ))}
                </div>
                <button
                  type="button"
                  className="btn-secondary tp-download"
                  onClick={() => setChoosing(p)}
                  aria-label={`See Team ${p.teamNumber}’s PDF`}
                >
                  <FileText aria-hidden="true" /> PDF
                </button>
                <a
                  className="btn-secondary tp-download"
                  href={service.trialPacketsUrl(courseId, caseId, p.teamId)}
                  download
                  aria-label={`Download Team ${p.teamNumber}’s packet`}
                >
                  <Download aria-hidden="true" /> Zip
                </a>
              </li>
            ))}
          </ul>
        </>
      )}
      {choosing && <PacketPdfModal courseId={courseId} caseId={caseId} packet={choosing} onClose={() => setChoosing(null)} />}
    </section>
  )
}
