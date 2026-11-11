import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  ArrowLeft,
  ArrowRight,
  Building2,
  FileSearch,
  FileText,
  Gavel,
  GraduationCap,
  Handshake,
  MessagesSquare,
  Scale,
  Search,
  Sparkles,
  UserRound,
} from 'lucide-react'
import { BrandIcon } from '../components/BrandIcon'
import { clearDemoSlides } from './demoSlidesQueue'

const CREATORS = ['Jennifer', 'Tajeira', 'Jason']

/** The steps of a lawsuit; a class today starts at the last one. */
const STEPS = [
  { icon: Search, label: 'Investigate' },
  { icon: FileText, label: 'Subpoena' },
  { icon: MessagesSquare, label: 'Depose' },
  { icon: Handshake, label: 'Negotiate' },
  { icon: Gavel, label: 'Trial' },
]

/** Who the student works with in the simulator, around them. */
const PLAYERS = [
  { icon: FileSearch, label: 'Investigator' },
  { icon: UserRound, label: 'Witnesses' },
  { icon: Building2, label: 'Records custodians' },
  { icon: Scale, label: 'Opposing counsel' },
  { icon: Gavel, label: 'Judge' },
]

function Creators() {
  return (
    <div className="ds-graphic ds-creators" aria-hidden="true">
      {CREATORS.map((name, i) => (
        <div key={name} className="ds-creator" style={{ animationDelay: `${0.25 + i * 0.15}s` }}>
          <span className="ds-creator-badge">{name[0]}</span>
          <span>{name}</span>
        </div>
      ))}
    </div>
  )
}

function Skipped() {
  return (
    <div className="ds-graphic ds-steps" aria-hidden="true">
      {STEPS.map(({ icon: Icon, label }, i) => {
        const trial = i === STEPS.length - 1
        return (
          <div key={label} className={`ds-step ${trial ? 'ds-step-on' : 'ds-step-off'}`} style={{ animationDelay: `${0.2 + i * 0.12}s` }}>
            <span className="ds-step-icon">
              <Icon />
            </span>
            <strong>{label}</strong>
            <small>{trial ? 'Where class starts' : 'Skipped'}</small>
          </div>
        )
      })}
    </div>
  )
}

function Hub() {
  // The players sit on a circle around the student, each joined to them by a line.
  const spots = PLAYERS.map((_, i) => {
    const angle = (-90 + (360 / PLAYERS.length) * i) * (Math.PI / 180)
    return { x: 50 + 40 * Math.cos(angle), y: 50 + 40 * Math.sin(angle) }
  })
  return (
    <div className="ds-graphic ds-hub" aria-hidden="true">
      <svg viewBox="0 0 100 100" width="100%" height="100%" preserveAspectRatio="none" className="ds-hub-lines">
        {spots.map((s, i) => (
          <line key={i} x1="50" y1="50" x2={s.x} y2={s.y} style={{ animationDelay: `${0.3 + i * 0.1}s` }} />
        ))}
      </svg>
      <div className="ds-hub-center">
        <GraduationCap />
        <span>Student</span>
      </div>
      {PLAYERS.map(({ icon: Icon, label }, i) => (
        <div
          key={label}
          className="ds-hub-node"
          style={{ left: `${spots[i].x}%`, top: `${spots[i].y}%`, animationDelay: `${0.4 + i * 0.1}s` }}
        >
          <span className="ds-hub-icon">
            <Icon />
            <Sparkles className="ds-hub-spark" />
          </span>
          <small>{label}</small>
        </div>
      ))}
    </div>
  )
}

const SLIDES: { title: string; eyebrow: string; body: ReactNode; graphic: ReactNode }[] = [
  {
    eyebrow: 'Welcome',
    title: 'Getting to Trial',
    body: <p className="ds-lead">A pre-trial simulator for trial advocacy classes, created by Jennifer, Tajeira, and Jason.</p>,
    graphic: <Creators />,
  },
  {
    eyebrow: 'Problem statement',
    title: 'Students only practice the last step',
    body: (
      <>
        <p className="ds-lead">
          Imagine that you’re a student in a trial advocacy class. Your expectation is that by the end of the semester, you
          should feel prepared to take on a real case.
        </p>
        <p>
          Right now, trial advocacy classes operate in a very nascent form; the instructor creates an entire case file and
          hands it to the students to litigate at trial, so students only practice the final step of litigating a case and
          have early difficulties stripped away.
        </p>
        <p>
          But this means that students miss out on essential pre-trial litigation skills like working with investigators,
          serving subpoenas, conducting depositions, interacting with opposing counsel, and much more!
        </p>
      </>
    ),
    graphic: <Skipped />,
  },
  {
    eyebrow: 'Our solution',
    title: 'The “Getting to Trial” pre-trial simulator',
    body: (
      <p className="ds-lead">
        We introduce the “Getting to Trial” pre-trial simulator! This product allows students to develop a “dynamic case
        file” putting them at the center of the process and strategy through AI-powered interactions with the key players in
        the lawsuit.
      </p>
    ),
    graphic: <Hub />,
  },
]

/**
 * The demo's opening slides, full screen like a presentation: who made it,
 * the problem, and the solution. Next and Back step through (or the arrow
 * keys); "Dive in!" on the last one closes them.
 */
export function DemoSlides({ onClose }: { onClose(): void }) {
  const [index, setIndex] = useState(0)
  const nextRef = useRef<HTMLButtonElement>(null)
  const last = index === SLIDES.length - 1
  const slide = SLIDES[index]

  function close() {
    clearDemoSlides()
    onClose()
  }

  useEffect(() => {
    nextRef.current?.focus()
  }, [index])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'ArrowRight') setIndex((i) => Math.min(i + 1, SLIDES.length - 1))
      else if (e.key === 'ArrowLeft') setIndex((i) => Math.max(i - 1, 0))
      else if (e.key === 'Escape') {
        clearDemoSlides()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="ds-backdrop">
      <section className="ds-slide" role="dialog" aria-modal="true" aria-labelledby="ds-title" aria-roledescription="slide">
        <header className="ds-top">
          <span className="ds-brand">
            <BrandIcon className="ds-brand-icon" />
            Getting to Trial
          </span>
          <span className="ds-count">
            {index + 1} / {SLIDES.length}
          </span>
        </header>

        <div className="ds-content" key={index}>
          <div className="ds-text">
            <span className="ds-eyebrow">{slide.eyebrow}</span>
            <h2 id="ds-title">{slide.title}</h2>
            {slide.body}
          </div>
          {slide.graphic}
        </div>

        <footer className="ds-bottom">
          <div className="ds-dots" aria-hidden="true">
            {SLIDES.map((s, i) => (
              <span key={s.title} className={i === index ? 'ds-dot ds-dot-on' : 'ds-dot'} />
            ))}
          </div>
          <div className="ds-buttons">
            {index > 0 && (
              <button type="button" className="btn-secondary" onClick={() => setIndex(index - 1)}>
                <ArrowLeft aria-hidden="true" />
                Back
              </button>
            )}
            <button ref={nextRef} type="button" className="btn-primary" onClick={() => (last ? close() : setIndex(index + 1))}>
              {last ? 'Dive in!' : 'Next'}
              {!last && <ArrowRight aria-hidden="true" />}
            </button>
          </div>
        </footer>
      </section>
    </div>
  )
}
