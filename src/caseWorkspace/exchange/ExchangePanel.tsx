import { useState } from 'react'
import { BookOpen, CheckCheck, CircleHelp, Lock, Users } from 'lucide-react'
import type { DisclosurePick, ExchangeKind, ItemResponse, StudentExchange } from '../../courses/types'
import { DisclosuresSection } from './DisclosuresSection'
import { RequestsSection } from './RequestsSection'
import { TeachMe, type TeachTopic } from './TeachMe'
import './exchange.css'

type Section = 'disclosures' | ExchangeKind

const OTHER_SIDE = { plaintiff: 'Defense', defense: 'Plaintiff' } as const

/**
 * A team's Information exchange tab: a menu of its parts (initial disclosures,
 * interrogatories, requests for admission) beside the one that's open. Each
 * part has a Teach me guide at its top right.
 */
export function ExchangePanel({
  exchange,
  onSubmitDisclosures,
  onSend,
  onRespond,
  now = new Date(),
}: {
  exchange: StudentExchange
  /** Leave these out to make it read-only (a closed case). */
  onSubmitDisclosures?(picks: DisclosurePick[], heldBackReason: string): Promise<void>
  onSend?(kind: ExchangeKind, items: string[]): Promise<void>
  onRespond?(requestId: string, responses: ItemResponse[]): Promise<void>
  now?: Date
}) {
  const parts: { id: Section; label: string; icon: typeof Users; locked: boolean; badge: string | null }[] = []
  if (exchange.disclosures) {
    const d = exchange.disclosures
    parts.push({
      id: 'disclosures',
      label: 'Initial disclosures',
      icon: Users,
      locked: false,
      badge: d.review ? 'Review' : d.submission ? 'Submitted' : d.open ? 'To do' : null,
    })
  }
  for (const [kind, label, icon] of [
    ['interrogatories', 'Interrogatories', CircleHelp],
    ['rfas', 'Requests for admission', CheckCheck],
  ] as const) {
    const part = exchange[kind]
    if (!part) continue
    const toRespond = part.requests.filter((r) => r.direction === 'received' && !r.respondedAt).length
    parts.push({
      id: kind,
      label,
      icon,
      locked: !exchange.requestsOpen,
      badge: toRespond > 0 ? `${toRespond} to respond` : `${part.remaining}/${part.limit} left`,
    })
  }
  const firstToDo = parts.find((p) => p.badge?.includes('to respond') || p.badge === 'To do')
  const [section, setSection] = useState<Section | undefined>(
    firstToDo?.id ?? parts.find((p) => !p.locked)?.id ?? parts[0]?.id,
  )
  const [teach, setTeach] = useState<TeachTopic | null>(null)

  if (parts.length === 0) {
    return (
      <section className="cw-card">
        <p className="cw-empty">Your instructor hasn&rsquo;t included anything in the information exchange for this case.</p>
      </section>
    )
  }

  return (
    <div className="ex">
      <nav className="ex-menu" aria-label="Information exchange">
        {parts.map((p) => (
          <button
            key={p.id}
            type="button"
            className="ex-menu-item"
            aria-current={section === p.id ? 'page' : undefined}
            onClick={() => setSection(p.id)}
          >
            {p.locked ? <Lock aria-hidden="true" /> : <p.icon aria-hidden="true" />}
            <span>{p.label}</span>
            {!p.locked && p.badge && (
              <span className={p.badge.includes('to respond') || p.badge === 'To do' ? 'cw-badge cw-badge-overdue' : 'cw-badge'}>
                {p.badge}
              </span>
            )}
          </button>
        ))}
        {!exchange.requestsOpen && parts.some((p) => p.locked) && (
          <p className="ex-menu-note">Interrogatories and requests for admission open in the information exchange phase.</p>
        )}
        <div className="ex-menu-teach">
          <strong>
            <BookOpen aria-hidden="true" /> New to discovery?
          </strong>
          <span>Look for the Teach me button at the top right of each section.</span>
        </div>
      </nav>
      <div className="ex-content">
        {section === 'disclosures' && exchange.disclosures && (
          <DisclosuresSection disclosures={exchange.disclosures} onSubmit={onSubmitDisclosures} onTeach={() => setTeach('disclosures')} />
        )}
        {(section === 'interrogatories' || section === 'rfas') && exchange[section] && (
          <RequestsSection
            key={section}
            kind={section}
            part={exchange[section]!}
            open={exchange.requestsOpen}
            opponentNumber={exchange.opponentNumber}
            opponentSide={OTHER_SIDE[exchange.side]}
            onSend={onSend && ((items) => onSend(section, items))}
            onRespond={onRespond}
            onTeach={() => setTeach(section)}
            now={now}
          />
        )}
      </div>
      {teach && (
        <TeachMe
          topic={teach}
          part={teach === 'disclosures' ? null : exchange[teach]}
          onClose={() => setTeach(null)}
        />
      )}
    </div>
  )
}
