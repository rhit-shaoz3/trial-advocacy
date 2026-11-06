import type { ReactNode } from 'react'
import confetti from 'canvas-confetti'
import { FileText, Gavel, ListChecks, MessageSquare, Search, ScrollText, Send, User } from 'lucide-react'
import { IntroStage } from '../../components/intro/IntroStage'
import { PHASE_LABEL } from '../../courses/caseLabels'
import type { CaseTab } from '../caseTabs'
import type { CaseIntro, ExchangePart } from './caseIntro'

const COLORS = ['#b98b42', '#a84b43', '#315e86', '#3f7d5c', '#f5f3ee']

const PART_TEXT: Record<ExchangePart, { title: string; detail: string }> = {
  interrogatories: { title: 'Interrogatories', detail: 'written questions the other side has to answer under oath' },
  rfas: { title: 'Requests for admission', detail: 'statements the other side has to admit or deny' },
  subpoenas: { title: 'Subpoenas', detail: 'demands for records from people and businesses outside the case' },
}

/**
 * The welcome for a case's launch (the senior partner's email flying in) or
 * for a new phase, each ending on a button that goes where the new work is.
 */
export function CaseIntroStage({
  intro,
  caseTitle,
  email,
  onEnter,
}: {
  intro: CaseIntro
  caseTitle: string
  /** The welcome email, for the launch; the case's summary stands in when there's none. */
  email: ReactNode
  /** Ends the intro on a tab (the launch ends on the overview). */
  onEnter(tab: CaseTab): void
}) {
  switch (intro.kind) {
    case 'launch':
      return (
        <IntroStage
          wide
          sceneMs={1900}
          scene={<EnvelopeScene />}
          eyebrow="Your case is open"
          title={caseTitle}
          action="Dive in"
          onLanded={() => {
            confetti({ particleCount: 80, spread: 75, startVelocity: 45, origin: { x: 0.5, y: 0.65 }, colors: COLORS, disableForReducedMotion: true })
          }}
          onEnter={() => onEnter('overview')}
        >
          {email}
        </IntroStage>
      )
    case 'information_exchange':
      return (
        <IntroStage
          scene={<TradeScene />}
          eyebrow="New phase"
          title={PHASE_LABEL.information_exchange}
          action="Try it"
          onEnter={() => onEnter('exchange')}
        >
          <p>Your team can now ask the other side for what it knows:</p>
          <ul className="intro-list">
            {intro.parts.map((p) => (
              <li key={p}>
                <strong>{PART_TEXT[p].title}</strong>: {PART_TEXT[p].detail}.
              </li>
            ))}
          </ul>
          <p className="muted">New to any of them? The Teach me lightbulb in the menu explains each one.</p>
        </IntroStage>
      )
    case 'investigate': {
      const { name, avatarUrl } = intro.investigator
      return (
        <IntroStage
          scene={<MagnifierScene />}
          eyebrow="New phase"
          title={PHASE_LABEL.investigate}
          action="Give them a case"
          onEnter={() => onEnter('investigator')}
        >
          <p className="intro-person">
            <img src={avatarUrl} alt="" />
            <span>
              <strong>{name}</strong>, your team’s investigator, is ready to work for you.
            </span>
          </p>
          <ul className="intro-list">
            <li>
              <strong>Email an assignment</strong>: what to look into, who to find, what to check.
            </li>
            <li>
              <strong>The report comes back</strong> in the Investigator tab, with any records attached and in your case file.
            </li>
            <li>One assignment at a time: the last report has to be back before you send the next.</li>
          </ul>
        </IntroStage>
      )
    }
    case 'deposition':
      return (
        <IntroStage
          sceneMs={2100}
          scene={<TalkScene witnesses={intro.witnesses} />}
          eyebrow="New phase"
          title={PHASE_LABEL.deposition}
          action="Meet the witnesses"
          onEnter={() => onEnter('witnesses')}
        >
          <p>You can now depose the other side’s witnesses:</p>
          <ul className="intro-witnesses">
            {intro.witnesses.map((w) => (
              <li key={w.id}>
                {w.avatarUrl ? (
                  <img src={w.avatarUrl} alt="" />
                ) : (
                  <span className="intro-witness-icon" aria-hidden="true">
                    <User />
                  </span>
                )}
                <span>
                  <strong>{w.name}</strong>
                  {w.role && <small>{w.role}</small>}
                </span>
              </li>
            ))}
          </ul>
          <p className="muted">Question each one from the Witnesses tab. Their answers become the transcript.</p>
        </IntroStage>
      )
    case 'final_steps':
      return (
        <IntroStage
          scene={<BoardScene />}
          eyebrow="New phase"
          title={PHASE_LABEL.final_steps}
          action="Build your list"
          onEnter={() => onEnter('final-steps')}
        >
          <p>Get ready for trial with a joint exhibit list:</p>
          <ol className="intro-steps">
            <li>
              <ListChecks aria-hidden="true" />
              <span>
                <strong>Build your list</strong> of everything you may use at trial. Anything not on it can’t be used.
              </span>
            </li>
            <li>
              <Send aria-hidden="true" />
              <span>
                <strong>Exchange lists</strong> with the other side once both are submitted.
              </span>
            </li>
            <li>
              <ScrollText aria-hidden="true" />
              <span>
                <strong>Review each other’s exhibits</strong>: authenticity first, then admission.
              </span>
            </li>
            <li>
              <Gavel aria-hidden="true" />
              <span>
                <strong>The judge rules</strong> on any challenge, and the final list is numbered for trial.
              </span>
            </li>
          </ol>
        </IntroStage>
      )
  }
}

/** A letter in its envelope flies in, lands, and opens. */
function EnvelopeScene() {
  return (
    <div className="scene-envelope">
      <div className="envelope">
        <span className="envelope-back" />
        <span className="envelope-letter">
          <span />
          <span />
          <span />
        </span>
        <span className="envelope-front" />
        <span className="envelope-flap" />
        <span className="envelope-seal" />
      </div>
    </div>
  )
}

/** Two people trade stacks of paper. */
function TradeScene() {
  return (
    <div className="scene-trade">
      <span className="trade-person trade-left">
        <User />
      </span>
      <span className="trade-papers trade-to-right">
        <FileText />
        <FileText />
      </span>
      <span className="trade-papers trade-to-left">
        <FileText />
        <FileText />
      </span>
      <span className="trade-person trade-right">
        <User />
      </span>
    </div>
  )
}

/** A magnifying glass sweeps over a page of notes, then zooms in. */
function MagnifierScene() {
  return (
    <div className="scene-magnifier">
      <span className="magnifier-page">
        {Array.from({ length: 7 }, (_, i) => (
          <span key={i} />
        ))}
      </span>
      <span className="magnifier-glass">
        <Search />
      </span>
    </div>
  )
}

/** Speech bubbles go back and forth, then the witnesses land: their pictures (with names), or just names. */
function TalkScene({ witnesses }: { witnesses: { id: string; name: string; avatarUrl: string | null }[] }) {
  return (
    <div className="scene-talk">
      <span className="talk-bubble talk-a">
        <MessageSquare />
      </span>
      <span className="talk-bubble talk-b">
        <MessageSquare />
      </span>
      <span className="talk-bubble talk-c">
        <MessageSquare />
      </span>
      <span className="talk-names">
        {witnesses.slice(0, 3).map((w, i) => (
          <span key={w.id} className={w.avatarUrl ? 'talk-witness' : undefined} style={{ animationDelay: `${1.1 + i * 0.18}s` }}>
            {w.avatarUrl && <img src={w.avatarUrl} alt="" />}
            {w.name}
          </span>
        ))}
      </span>
    </div>
  )
}

/** Exhibits are pinned to a board, and a red string joins two. */
function BoardScene() {
  return (
    <div className="scene-board">
      <span className="board">
        {['P-1', 'D-A', 'P-2'].map((label, i) => (
          <span key={label} className={`board-card board-card-${i + 1}`}>
            <span className="board-pin" />
            {label}
          </span>
        ))}
        <svg className="board-string" viewBox="0 0 100 60" preserveAspectRatio="none">
          <path d="M22 22 Q50 52 78 24" />
        </svg>
      </span>
    </div>
  )
}
