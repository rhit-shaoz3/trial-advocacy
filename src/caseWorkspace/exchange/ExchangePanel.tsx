import { useMemo, useState } from 'react'
import { BookOpen, CheckCheck, CircleHelp, Lock, ScrollText, Users } from 'lucide-react'
import type {
  CaseParties,
  CheckInput,
  DiscoveryCheck,
  DisclosurePick,
  ExchangeKind,
  ItemResponse,
  StudentExchange,
  SubpoenaInput,
} from '../../courses/types'
import { DisclosuresSection } from './DisclosuresSection'
import { RequestsSection } from './RequestsSection'
import { SubpoenasSection } from './SubpoenasSection'
import { TeachMe, type TeachTopic } from './TeachMe'
import type { DraftActions } from './useDraft'
import { useTourNavigator } from '../../tour/tourContext'
import './exchange.css'

type Section = 'disclosures' | 'subpoenas' | ExchangeKind

const OTHER_SIDE = { plaintiff: 'Defense', defense: 'Plaintiff' } as const

/** "Subpoenas, interrogatories, and requests for admission", from the parts' labels. */
function listOf(labels: string[]) {
  const [first, ...rest] = labels.map((l, i) => (i === 0 ? l : l.toLowerCase()))
  if (rest.length === 0) return first
  return rest.length === 1 ? `${first} and ${rest[0]}` : `${[first, ...rest.slice(0, -1)].join(', ')}, and ${rest.at(-1)}`
}

/**
 * A team's Information exchange tab: a menu of its parts (initial disclosures,
 * subpoenas, interrogatories, requests for admission) beside the one that's open. Each
 * part has a Teach me guide at its top right.
 */
export function ExchangePanel({
  exchange,
  onSubmitDisclosures,
  onSend,
  onRespond,
  onServeSubpoena,
  onCheck,
  onOpenDocument,
  subpoenaForm,
  focus,
  drafts,
  initialDraftId,
  onOpenDraft,
  now = new Date(),
}: {
  exchange: StudentExchange
  /** Leave these out to make it read-only (a closed case). */
  onSubmitDisclosures?(picks: DisclosurePick[], heldBackReason: string): Promise<void>
  onSend?(kind: ExchangeKind, items: string[], checkId?: string, draftId?: string): Promise<void>
  onRespond?(requestId: string, responses: ItemResponse[], checkId?: string): Promise<void>
  onServeSubpoena?(subpoena: SubpoenaInput, checkId?: string, draftId?: string): Promise<void>
  /** "Check with AI" before sending; leave out to send without it. */
  onCheck?(input: CheckInput): Promise<DiscoveryCheck>
  /** Opens a case file produced in answer to a subpoena. */
  onOpenDocument?(materialId: string): void
  /** The case and student, for filling in the subpoena form. */
  subpoenaForm: { caseId: string; parties: CaseParties; attorney: string | null }
  /** A request or subpoena to open on, as when a notice links to its answer. */
  focus?: { kind: ExchangeKind | 'subpoenas'; id: string } | null
  /** Saves and deletes the team's drafts of new subpoenas and sets; leave out to not keep drafts. */
  drafts?: DraftActions
  /** A draft to open on, as after a refresh. */
  initialDraftId?: string
  /** Called with the open draft's id, and null on leaving it. */
  onOpenDraft?(draftId: string | null): void
  now?: Date
}) {
  // The section holding the draft to open on.
  const draftSection: Section | undefined = !initialDraftId
    ? undefined
    : exchange.subpoenas?.drafts.some((d) => d.id === initialDraftId)
      ? 'subpoenas'
      : (['interrogatories', 'rfas'] as const).find((k) => exchange[k]?.drafts.some((d) => d.id === initialDraftId))
  // Opened once: switching sections lets it go.
  const [pendingDraft, setPendingDraft] = useState(draftSection && initialDraftId)
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
  if (exchange.subpoenas) {
    const part = exchange.subpoenas
    // Answers to the team's subpoenas, and notices of the other team's, not yet seen.
    const answers =
      part.served.filter((s) => s.respondedAt && !s.seen).length + part.notices.filter((n) => n.seen === false).length
    parts.push({
      id: 'subpoenas',
      label: 'Subpoenas',
      icon: ScrollText,
      locked: !exchange.requestsOpen,
      badge: answers > 0 ? `${answers} new` : `${part.remaining}/${part.limit} left`,
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
    draftSection ??
      (focus && parts.some((p) => p.id === focus.kind) ? focus.kind : undefined) ??
      firstToDo?.id ??
      parts.find((p) => !p.locked)?.id ??
      parts[0]?.id,
  )
  const [teach, setTeach] = useState<TeachTopic | null>(null)
  // Guided tours open the section a step is about.
  const sectionIds = parts.map((p) => p.id).join(' ')
  const tourNavigator = useMemo(
    () => ({
      selectSection: (id: string) => {
        if (!sectionIds.split(' ').includes(id)) return
        setSection(id as Section)
        setPendingDraft(undefined)
      },
    }),
    [sectionIds],
  )
  useTourNavigator(tourNavigator)

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
            data-tour={`ex-menu-${p.id}`}
            aria-current={section === p.id ? 'page' : undefined}
            onClick={() => {
              setSection(p.id)
              setPendingDraft(undefined)
            }}
          >
            {p.locked ? <Lock aria-hidden="true" /> : <p.icon aria-hidden="true" />}
            <span>{p.label}</span>
            {!p.locked && p.badge && (
              <span
                className={
                  p.badge.includes('to respond') || p.badge === 'To do'
                    ? 'cw-badge cw-badge-overdue'
                    : p.badge.endsWith(' new')
                      ? 'cw-badge cw-badge-new'
                      : 'cw-badge'
                }
              >
                {p.badge}
              </span>
            )}
          </button>
        ))}
        {!exchange.requestsOpen && parts.some((p) => p.locked) && (
          <p className="ex-menu-note">{listOf(parts.filter((p) => p.locked).map((p) => p.label))} open in the information exchange phase.</p>
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
        {section === 'subpoenas' && exchange.subpoenas && (
          <SubpoenasSection
            part={exchange.subpoenas}
            form={{ ...subpoenaForm, side: exchange.side, firm: exchange.firm }}
            open={exchange.requestsOpen}
            opponentNumber={exchange.opponentNumber}
            onServe={onServeSubpoena}
            onCheck={onCheck}
            onOpenDocument={onOpenDocument}
            onTeach={() => setTeach('subpoenas')}
            initialSubpoenaId={focus?.kind === 'subpoenas' ? focus.id : undefined}
            drafts={drafts}
            initialDraftId={pendingDraft}
            onOpenDraft={onOpenDraft}
            now={now}
          />
        )}
        {(section === 'interrogatories' || section === 'rfas') && exchange[section] && (
          <RequestsSection
            key={section}
            kind={section}
            part={exchange[section]!}
            open={exchange.requestsOpen}
            opponentNumber={exchange.opponentNumber}
            opponentSide={OTHER_SIDE[exchange.side]}
            onSend={onSend && ((items, checkId, draftId) => onSend(section, items, checkId, draftId))}
            onRespond={onRespond}
            onCheck={onCheck}
            onTeach={() => setTeach(section)}
            initialRequestId={focus?.kind === section ? focus.id : undefined}
            drafts={drafts}
            initialDraftId={pendingDraft}
            onOpenDraft={onOpenDraft}
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
