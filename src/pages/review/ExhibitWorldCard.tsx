import { Scale } from 'lucide-react'
import type { ExhibitReview, ExhibitReviewWorld } from '../../courses/types'
import { worldLabel } from '../../courses/worldLabel'
import { PeekRow } from '../cases/finalSteps/FinalStepsTab'
import { useExhibitViewer } from '../cases/finalSteps/useExhibitViewer'
import { ExhibitPairCard } from './ExhibitPairCard'
import { ExhibitReviewCard } from './ExhibitReviewCard'
import '../../caseWorkspace/finalSteps/exhibits.css'

const plural = (n: number, noun: string) => `${n} ${noun}${n === 1 ? '' : 's'}`
const IN_REVIEW = new Set(['authenticity_review', 'admission_review'])

/**
 * One case world's exhibit list, once its teams have settled what they can,
 * for the instructor to rule on as the judge: each challenge the teams kept,
 * with the usual ruling options, and the rest of the list for context.
 * Without `onRuled` (Completed reviews), it shows the rulings.
 */
export function ExhibitWorldCard({ courseId, world, onRuled }: { courseId: string; world: ExhibitReviewWorld; onRuled?(): void }) {
  const viewer = useExhibitViewer(courseId, world.caseId)
  const ruling = (x: ExhibitReview) => (onRuled ? IN_REVIEW.has(x.status) : x.ruledAt !== null)
  const toRule = world.exhibits.filter(ruling)
  const rest = world.exhibits.filter((x) => !ruling(x))
  const headingId = `exhibit-world-${world.matchupId}`
  return (
    <article className="review-card exhibit-world" aria-labelledby={headingId}>
      <header className="review-card-header">
        <span className="ws-icon-tile ws-tone-blue" aria-hidden="true">
          <Scale />
        </span>
        <div className="review-card-title">
          <span className="ws-eyebrow">
            {world.caseTitle} · {onRuled ? 'Exhibit list to rule on' : 'Exhibit rulings'}
          </span>
          <h2 id={headingId}>Case world {worldLabel(world.worldNumber)}</h2>
          <p className="review-meta">
            Team {world.teams.plaintiff ?? '?'} (Plaintiff) v. Team {world.teams.defense ?? '?'} (Defense) ·{' '}
            {onRuled ? `${plural(toRule.length, 'exhibit')} to rule on` : `${plural(toRule.length, 'exhibit')} ruled on`}
          </p>
        </div>
      </header>
      <ul className="review-list exhibit-world-list" aria-label={onRuled ? 'Exhibits to rule on' : 'Exhibits ruled on'}>
        {toRule.map((x) => {
          // Two versions of one document waiting together are ruled on together, under the plaintiff's.
          const partner = onRuled && x.pairedWith ? toRule.find((o) => o.id === x.pairedWith) : undefined
          if (partner && x.offeredBy === 'defense') return null
          return (
            <li key={x.id}>
              {partner ? (
                <ExhibitPairCard courseId={courseId} versions={[x, partner]} onRuled={onRuled!} />
              ) : (
                <ExhibitReviewCard courseId={courseId} review={x} onRuled={onRuled} />
              )}
            </li>
          )
        })}
      </ul>
      {rest.length > 0 && (
        <details className="xl-out">
          <summary>
            {onRuled ? 'The rest of the list' : 'The rest of the list, as the teams settled it'} ({rest.length})
          </summary>
          <ul className="xl-rows">
            {rest.map((x) => (
              <PeekRow key={x.id} exhibit={x} onOpen={() => viewer.open(x)} />
            ))}
          </ul>
        </details>
      )}
      {viewer.element}
    </article>
  )
}
