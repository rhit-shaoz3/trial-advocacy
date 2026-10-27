import type { ReactNode } from 'react'
import { BookOpen, Check, Clock, ListChecks, Lock, MessageSquare, Sparkles, TriangleAlert } from 'lucide-react'
import { Modal } from '../../components/Modal'
import { FEDERAL, type PartSettings } from '../../courses/types'

export type TeachTopic = 'disclosures' | 'interrogatories' | 'rfas'

/**
 * The "Teach me" guide for one part of the information exchange: the rule
 * behind it, how litigators use it, and, when the instructor's settings
 * differ from the federal rule, how this case differs.
 */
export function TeachMe({
  topic,
  part,
  onClose,
}: {
  topic: TeachTopic
  /** The case's limit and days to respond, to compare with the federal rule. */
  part?: Pick<PartSettings, 'limit' | 'days'> | null
  onClose(): void
}) {
  const close = (
    <button type="button" className="ws-btn ws-btn-primary" onClick={onClose}>
      Got it
    </button>
  )
  if (topic === 'disclosures') {
    return (
      <Modal eyebrow="Teach me · FRCP 26(a)(1)" title="What are initial disclosures?" icon={<BookOpen />} onClose={onClose} footer={close}>
        <div className="teach">
          <p>
            Early in a federal case, each side has to hand over certain information without being asked. Under FRCP
            26(a)(1)(A), that includes the name of each person likely to have information you may use to support your
            claims or defenses, and a copy or description of the documents you may use.
          </p>
          <Fact icon={<Clock />}>
            In federal court, they&rsquo;re due within 14 days after the parties&rsquo; Rule 26(f) conference, unless the court
            sets another date.
          </Fact>
          <h3>How litigators think about it</h3>
          <div className="teach-pair">
            <div className="teach-risk teach-risk-amber">
              <strong>
                <TriangleAlert aria-hidden="true" /> Share too much
              </strong>
              <p>You give the other side information for free, and you may point them to weak spots they hadn&rsquo;t found.</p>
            </div>
            <div className="teach-risk teach-risk-rose">
              <strong>
                <Lock aria-hidden="true" /> Share too little
              </strong>
              <p>
                Under FRCP 37(c)(1), a witness or document you should have disclosed can be excluded, so you may not be
                able to use it at trial.
              </p>
            </div>
          </div>
          <Tips
            tips={[
              'Disclose what you may use. You don’t have to disclose material that only helps the other side.',
              'Disclosures aren’t one and done. FRCP 26(e) requires you to supplement them if you learn they’re incomplete.',
              'Think about the trial: anything you’ll want to show the jury should be on your list.',
            ]}
          />
          <p className="teach-note">
            In this course, your picks are practice. When your instructor moves the case to information exchange,
            you&rsquo;ll see how your picks compare with your instructor&rsquo;s.
          </p>
        </div>
      </Modal>
    )
  }

  if (topic === 'interrogatories') {
    const differs: string[] = []
    if (part && part.limit !== FEDERAL.interrogatoryLimit) {
      differs.push(`allows ${part.limit} interrogatories per team instead of ${FEDERAL.interrogatoryLimit}`)
    }
    if (part && part.days !== FEDERAL.responseDays) {
      differs.push(`gives ${part.days} days to answer instead of ${FEDERAL.responseDays}`)
    }
    return (
      <Modal eyebrow="Teach me · FRCP 33" title="What are interrogatories?" icon={<BookOpen />} onClose={onClose} footer={close}>
        <div className="teach">
          <p>
            Interrogatories are written questions one party sends another. The other side has to answer each one
            separately and fully, in writing and under oath (FRCP 33(b)(3)), or state its objection.
          </p>
          <div className="teach-rules">
            <Rule icon={<ListChecks />} big="Up to 25" detail="questions, counting discrete subparts (FRCP 33(a)(1))" />
            <Rule icon={<Clock />} big="30 days" detail="to answer once they’re served (FRCP 33(b)(2))" />
          </div>
          {differs.length > 0 && <Differs text={`Your instructor ${differs.join(', and ')}.`} />}
          <h3>How litigators use them</h3>
          <Tips
            tips={[
              'Pin down basic facts early: names, dates, documents, insurance.',
              'Find out who knows what, so you know whom to depose.',
              'Make the other side commit to its theory. Contention interrogatories are allowed (FRCP 33(a)(2)).',
            ]}
          />
          <Fact icon={<Sparkles />}>
            Spend your questions on facts you can&rsquo;t get elsewhere. Save open-ended &ldquo;why&rdquo; questions for
            depositions, and keep each question to one subject so it counts once: every lettered subpart, like (a) and (b),
            counts as its own question.
          </Fact>
        </div>
      </Modal>
    )
  }

  const differs = part && part.days !== FEDERAL.responseDays
  return (
    <Modal eyebrow="Teach me · FRCP 36" title="What are requests for admission?" icon={<BookOpen />} onClose={onClose} footer={close}>
      <div className="teach">
        <p>
          A request for admission asks the other side to admit that a fact is true, that a document is genuine, or how the
          law applies to the facts (FRCP 36(a)(1)). Anything admitted is settled for the case and doesn&rsquo;t have to be
          proven at trial (FRCP 36(b)).
        </p>
        <div className="teach-rules">
          <Rule icon={<ListChecks />} big="No set limit" detail="on the number of requests, though many courts set one" />
          <Rule icon={<Clock />} big="30 days" detail="to respond, or the request counts as admitted (FRCP 36(a)(3))" />
        </div>
        {part && (
          <Differs
            text={`Your instructor allows ${part.limit} requests per team${
              differs ? ` and gives ${part.days} days to respond instead of ${FEDERAL.responseDays}` : ''
            }.`}
          />
        )}
        <h3>How litigators use them</h3>
        <Tips
          tips={[
            'Narrow the trial to what’s really disputed.',
            'Confirm that documents are genuine, so you don’t need a witness for each one.',
            'Pin down facts you’d otherwise have to prove with testimony.',
          ]}
        />
        <Fact icon={<MessageSquare />}>
          When you respond: agree, disagree, or agree in part. If you agree in part, say exactly which part (FRCP 36(a)(4)).
        </Fact>
        <Fact icon={<Sparkles />}>Keep each request to one simple fact. Requests that bundle several facts are easy to deny.</Fact>
      </div>
    </Modal>
  )
}

function Fact({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <p className="teach-fact">
      <span aria-hidden="true">{icon}</span>
      <span>{children}</span>
    </p>
  )
}

function Rule({ icon, big, detail }: { icon: ReactNode; big: string; detail: string }) {
  return (
    <div className="teach-rule">
      <small>
        <span aria-hidden="true">{icon}</span> Federal rule
      </small>
      <strong>{big}</strong>
      <span>{detail}</span>
    </div>
  )
}

function Differs({ text }: { text: string }) {
  return (
    <div className="teach-differs" role="note">
      <TriangleAlert aria-hidden="true" />
      <span>
        <strong>Your case is different</strong>
        {text}
      </span>
    </div>
  )
}

function Tips({ tips }: { tips: string[] }) {
  return (
    <ul className="teach-tips">
      {tips.map((t) => (
        <li key={t}>
          <Check aria-hidden="true" />
          {t}
        </li>
      ))}
    </ul>
  )
}
