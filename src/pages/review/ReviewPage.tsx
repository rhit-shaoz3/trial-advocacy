import { useCallback, useEffect, useState } from 'react'
import { useOutletContext, useParams, useSearchParams } from 'react-router'
import { useCourseService } from '../../courses/CourseServiceContext'
import type { CourseCase, CourseFlag, CourseSubpoena, FactGroup, InterviewReview } from '../../courses/types'
import type { WorkspaceContext } from '../../workspace/useWorkspace'
import './Review.css'
import { FactGroupCard } from './FactGroupCard'
import { FactsPanel } from './FactsPanel'
import { FlagCard } from './FlagCard'
import { ReviewCard } from './ReviewCard'
import { SubpoenaCard } from './SubpoenaCard'

type Tab = 'open' | 'completed'

/** How often the list refreshes while the AI is still working on a review. */
const POLL_MS = 5000

/**
 * The instructor's review panel: what students flagged (in review lite), the
 * subpoenas teams served, similar new facts from different teams to rule on
 * together, and each conversation a team ended and each background
 * investigator report. A review finishes once everything in it is ruled; its
 * rulings bind later interviews and tell the team what stands. Beside it, the
 * running list of facts for a case, and how that case is reviewed.
 */
export function ReviewPage() {
  const { courseId = '' } = useParams()
  const service = useCourseService()
  const workspace = useOutletContext<WorkspaceContext | undefined>()
  const [params, setParams] = useSearchParams()
  const tab: Tab = params.get('tab') === 'completed' ? 'completed' : 'open'
  const [reviews, setReviews] = useState<InterviewReview[] | null>(null)
  const [groups, setGroups] = useState<FactGroup[]>([])
  const [flags, setFlags] = useState<CourseFlag[]>([])
  const [subpoenas, setSubpoenas] = useState<CourseSubpoena[] | null>(null)
  const [cases, setCases] = useState<CourseCase[]>([])
  const [factsCase, setFactsCase] = useState<string | null>(null)
  /** Bumped after each ruling, so the facts panel catches up. */
  const [version, setVersion] = useState(0)
  const [error, setError] = useState<string | null>(null)
  /** Reviews that just finished here, for a note saying where they went. */
  const [finished, setFinished] = useState<InterviewReview | null>(null)
  const reloadHome = workspace?.reloadHome

  const load = useCallback(
    async (which: Tab) => {
      if (which === 'open') {
        const [queue, served] = await Promise.all([service.listReviewQueue(courseId), service.listSubpoenas(courseId, which)])
        return { reviews: queue.reviews, groups: queue.groups, flags: queue.flags, subpoenas: served }
      }
      const [list, served] = await Promise.all([service.listReviews(courseId, which), service.listSubpoenas(courseId, which)])
      return { reviews: list, groups: [], flags: [], subpoenas: served }
    },
    [service, courseId],
  )

  const show = useCallback((loaded: Awaited<ReturnType<typeof load>>) => {
    setReviews(loaded.reviews)
    setGroups(loaded.groups)
    setFlags(loaded.flags)
    setSubpoenas(loaded.subpoenas)
  }, [])

  useEffect(() => {
    let cancelled = false
    setReviews(null)
    setSubpoenas(null)
    setError(null)
    setFinished(null)
    load(tab)
      .then((loaded) => !cancelled && show(loaded))
      .catch((err: Error) => !cancelled && setError(err.message))
    return () => {
      cancelled = true
    }
  }, [load, show, tab])

  useEffect(() => {
    service
      .listCases(courseId)
      .then(setCases)
      .catch(() => {}) // the facts panel is extra; the queue works without it
  }, [service, courseId])

  /** Reloads everything after a change that can move items between lists. */
  const refresh = useCallback(async () => {
    setVersion((v) => v + 1)
    try {
      show(await load(tab))
    } catch {
      // keep the current lists; the next change or visit loads them
    }
    void reloadHome?.()
  }, [load, show, tab, reloadHome])

  // The AI lists a conversation's facts (or investigates, or writes a team's
  // report, or drafts a subpoena's response) in the background; check back
  // until it's done.
  const working =
    (reviews?.some((r) => r.status === 'summarizing' || r.status === 'finalizing') ?? false) ||
    (subpoenas?.some((s) => s.status === 'drafting') ?? false)
  useEffect(() => {
    if (!working) return
    const timer = setInterval(() => {
      load(tab)
        .then((loaded) => {
          // A team's report that couldn't be written goes back to To review, so the waiting count changes.
          setReviews((prev) => {
            if (prev?.some((r) => r.status === 'finalizing' && !loaded.reviews.some((n) => n.id === r.id))) void reloadHome?.()
            return prev
          })
          show(loaded)
        })
        .catch(() => {}) // keep the current list; the next tick tries again
    }, POLL_MS)
    return () => clearInterval(timer)
  }, [load, show, tab, working, reloadHome])

  function selectTab(next: Tab) {
    setParams((prev) => {
      const updated = new URLSearchParams(prev)
      if (next === 'open') updated.delete('tab')
      else updated.set('tab', next)
      return updated
    })
  }

  /** A ruling: a review that finished leaves To review (an investigation's report is written in Completed). */
  function changed(updated: InterviewReview) {
    setVersion((v) => v + 1)
    const done = updated.status === 'completed' || updated.status === 'finalizing'
    if (tab === 'open' && done) {
      setReviews((prev) => prev?.filter((r) => r.id !== updated.id) ?? null)
      setFinished(updated)
      void reloadHome?.()
    } else setReviews((prev) => prev?.map((r) => (r.id === updated.id ? updated : r)) ?? null)
  }

  /** A subpoena whose response is being redrafted, in place. */
  function replaceSubpoena(updated: CourseSubpoena) {
    setSubpoenas((prev) => prev?.map((s) => (s.id === updated.id ? updated : s)) ?? null)
  }

  /** An answered subpoena leaves To review; the waiting count follows from the server. */
  function answered(subpoena: CourseSubpoena) {
    setSubpoenas((prev) => prev?.filter((s) => s.id !== subpoena.id) ?? null)
    void reloadHome?.()
  }

  const loaded = reviews && subpoenas
  const empty = loaded && reviews.length === 0 && subpoenas.length === 0 && groups.length === 0 && flags.length === 0
  // The facts panel follows the top item, until the instructor picks a case.
  const topCase = flags[0]?.caseId ?? subpoenas?.[0]?.caseId ?? groups[0]?.caseId ?? reviews?.[0]?.caseId
  const shownCase = factsCase ?? (cases.some((c) => c.id === topCase) ? topCase! : cases[0]?.id)

  return (
    <main className="ws-page review-page">
      <div className="ws-welcome">
        <div>
          <span className="ws-eyebrow">Instructor</span>
          <h1 className="ws-title">Review</h1>
          <p className="ws-subtle">
            When a team ends an interview, the new facts the AI witness added come here, and so does every background
            investigator report before the team sees it. Rule on each fact as the judge: it stands or it doesn&rsquo;t,
            for that team&rsquo;s case world or for every world. Similar facts from different teams are grouped so you
            can rule on them once. Subpoenas teams serve come here too, with the AI&rsquo;s draft of the
            recipient&rsquo;s response. In review lite, only what students flag comes here.
          </p>
        </div>
      </div>

      <div className="review-tabs" role="tablist" aria-label="Reviews">
        <button type="button" role="tab" aria-selected={tab === 'open'} className="review-tab" onClick={() => selectTab('open')}>
          To review{workspace?.home.reviewCount ? ` (${workspace.home.reviewCount})` : ''}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'completed'}
          className="review-tab"
          onClick={() => selectTab('completed')}
        >
          Completed reviews
        </button>
      </div>

      <div className={shownCase ? 'review-layout' : undefined}>
        <div className="review-queue">
          {finished && (
            <p className="review-finished" role="status">
              {finished.kind === 'investigation'
                ? `Investigation for Team ${finished.teamNumber} is done; their report is being written.`
                : `Interview of ${finished.witness?.name} for Team ${finished.teamNumber} is done.`}{' '}
              You can still change its rulings in{' '}
              <button type="button" className="link-button" onClick={() => selectTab('completed')}>
                Completed reviews
              </button>
              .
            </p>
          )}
          {error ? (
            <p className="form-error" role="alert">
              Could not load the reviews. {error}
            </p>
          ) : !loaded ? (
            <p className="ws-subtle">Loading reviews…</p>
          ) : empty ? (
            <div className="ws-empty">
              <p className="case-empty-title">{tab === 'open' ? 'Nothing to review.' : 'No completed reviews yet.'}</p>
              <p className="ws-subtle">
                {tab === 'open'
                  ? 'Conversations show up here when a team ends an interview with an AI witness, reports when the investigator answers a team, and subpoenas when a team serves one.'
                  : 'Reviews you finish and subpoenas you answer are kept here.'}
              </p>
            </div>
          ) : (
            <>
              {flags.length > 0 && (
                <>
                  <h2 className="review-section-title">Flagged by students</h2>
                  <ul className="review-list" aria-label="Flagged by students">
                    {flags.map((f) => (
                      <li key={f.id}>
                        <FlagCard courseId={courseId} flag={f} onDone={refresh} />
                      </li>
                    ))}
                  </ul>
                </>
              )}
              {subpoenas.length > 0 && (
                <>
                  <h2 className="review-section-title">Subpoenas</h2>
                  <ul className="review-list" aria-label={tab === 'open' ? 'Subpoenas to answer' : 'Answered subpoenas'}>
                    {subpoenas.map((s) => (
                      <li key={s.id}>
                        <SubpoenaCard
                          courseId={courseId}
                          subpoena={s}
                          onAnswer={tab === 'open' ? answered : undefined}
                          onChange={replaceSubpoena}
                        />
                      </li>
                    ))}
                  </ul>
                </>
              )}
              {groups.length > 0 && (
                <>
                  <h2 className="review-section-title">Similar facts from different teams</h2>
                  <ul className="review-list" aria-label="Similar facts">
                    {groups.map((g) => (
                      <li key={g.id}>
                        <FactGroupCard courseId={courseId} group={g} reviews={reviews} onDone={refresh} />
                      </li>
                    ))}
                  </ul>
                </>
              )}
              {reviews.length > 0 && (
                <>
                  {(subpoenas.length > 0 || groups.length > 0 || flags.length > 0) && (
                    <h2 className="review-section-title">Interviews and reports</h2>
                  )}
                  <ul className="review-list" aria-label={tab === 'open' ? 'To review' : 'Completed reviews'}>
                    {reviews.map((r) => (
                      <li key={r.id}>
                        <ReviewCard courseId={courseId} review={r} onChange={changed} />
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </>
          )}
        </div>
        {shownCase && (
          <FactsPanel
            courseId={courseId}
            cases={cases}
            caseId={shownCase}
            onCaseChange={setFactsCase}
            onCaseUpdate={(updated) => setCases((prev) => prev.map((c) => (c.id === updated.id ? updated : c)))}
            version={version}
          />
        )}
      </div>
    </main>
  )
}
