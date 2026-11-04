import { useEffect, useState } from 'react'
import { AlertTriangle, Download, FolderArchive } from 'lucide-react'
import { useCourseService } from '../../../courses/CourseServiceContext'
import { EXHIBIT_SIDE } from '../../../courses/exhibitLabels'
import { worldLabel } from '../../../courses/worldLabel'
import type { TrialPacket } from '../../../courses/types'

const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

/** What a team's packet holds, in a line. */
function holds(p: TrialPacket) {
  return [
    count(p.depositions, 'deposition'),
    count(p.exhibits, 'admitted exhibit'),
    count(p.files, 'case file'),
    count(p.reports, 'investigator report'),
    count(p.discovery, 'discovery set'),
  ].join(' · ')
}

/**
 * The end of the case: each team's trial packet to download, to read through
 * and hand to the team. It can be downloaded any time in final steps; what
 * isn't finished yet is pointed out here and in the packet.
 */
export function TrialPackets({ courseId, caseId }: { courseId: string; caseId: string }) {
  const service = useCourseService()
  const [packets, setPackets] = useState<TrialPacket[] | null>(null)
  const [error, setError] = useState<string | null>(null)

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
          <span className="ws-eyebrow">The end of the case</span>
          <h2 id="packets-heading">Trial packets</h2>
        </div>
        {packets && packets.length > 0 && (
          <a className="btn-primary tp-all" href={service.trialPacketsUrl(courseId, caseId)} download>
            <Download aria-hidden="true" /> Download all (.zip)
          </a>
        )}
      </div>
      <p className="muted">
        Each team’s packet has its admitted exhibits and the joint exhibit list, every deposition taken in its case world, and
        the case files, investigator reports, discovery, and ruled facts it gathered. Nothing from the other team’s private work
        is included, so each packet is ready to hand to its team.
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
                <a
                  className="btn-secondary tp-download"
                  href={service.trialPacketsUrl(courseId, caseId, p.teamId)}
                  download
                  aria-label={`Download Team ${p.teamNumber}’s packet`}
                >
                  <Download aria-hidden="true" /> Download
                </a>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  )
}
