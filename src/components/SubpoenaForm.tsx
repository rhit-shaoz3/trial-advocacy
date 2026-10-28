import { courtDetails, formDate, SUBPOENA_TYPE_LABEL } from '../courses/subpoenaForm'
import type { CaseParties, Firm, Side, SubpoenaType } from '../courses/types'
import './SubpoenaForm.css'

/**
 * A subpoena laid out like the federal form, AO 88B (Subpoena to Produce
 * Documents, Information, or Objects or to Permit Inspection of Premises in a
 * Civil Action), filled in from what the team wrote. The court's details are
 * made up for the case; only the team's fields are stored.
 */
export function SubpoenaForm({
  caseId,
  parties,
  side,
  firm,
  attorney,
  recipient,
  requestType,
  records,
  servedAt,
  dueAt,
}: {
  caseId: string
  parties: CaseParties
  /** The side serving it. */
  side: Side
  firm: Firm
  /** Who signs it for the team. */
  attorney: string | null
  recipient: string
  requestType: SubpoenaType | null
  records: string
  /** When it was served; null while it's being written (dated today). */
  servedAt: string | null
  /** When it's due. */
  dueAt: string | null
}) {
  const court = courtDetails(caseId)
  const plaintiff = parties.plaintiff || 'Plaintiff'
  const defendant = parties.defendant || 'Defendant'
  const party = side === 'plaintiff' ? plaintiff : defendant
  const inspection = requestType === 'inspection'
  // Neither box is ticked until the team picks what it wants.
  const production = requestType !== null && !inspection
  const when = dueAt ? `${formDate(dueAt)}, 10:00 a.m.` : ''
  const office = firm.firm ? `Offices of ${firm.firm}` : `Offices of counsel for ${party}`
  const blank = <span className="sf-blank">&nbsp;</span>
  const what = records.trim() ? <p className="sf-filled sf-records">{records.trim()}</p> : <p className="sf-blank sf-records">&nbsp;</p>

  return (
    <article className="sf-page" aria-label="Subpoena form">
      <p className="sf-form-id">
        AO 88B (Rev. 02/14) Subpoena to Produce Documents, Information, or Objects or to Permit Inspection of Premises in a Civil
        Action
      </p>
      <header className="sf-court">
        <h3>United States District Court</h3>
        <p>for the</p>
        <p className="sf-filled">{court.district}</p>
      </header>

      <div className="sf-caption">
        <div className="sf-parties">
          <p className="sf-filled sf-line">{plaintiff}</p>
          <small>Plaintiff</small>
          <p className="sf-v">v.</p>
          <p className="sf-filled sf-line">{defendant}</p>
          <small>Defendant</small>
        </div>
        <div className="sf-brace" aria-hidden="true">
          )<br />)<br />)<br />)<br />)
        </div>
        <p className="sf-action">
          Civil Action No. <span className="sf-filled">{court.actionNumber}</span>
        </p>
      </div>

      <h4 className="sf-title">
        Subpoena to produce documents, information, or objects
        <br />
        or to permit inspection of premises in a civil action
      </h4>

      <div className="sf-to">
        <span>To:</span>
        <p className="sf-filled sf-line">{recipient.trim() || blank}</p>
        <small>(Name of person to whom this subpoena is directed)</small>
      </div>

      <div className="sf-command">
        <p>
          <span className="sf-box" role="img" aria-label={production ? 'Checked' : 'Not checked'}>
            {production ? '✕' : ''}
          </span>
          <em>Production:</em> <strong>YOU ARE COMMANDED</strong> to produce at the time, date, and place set forth below the
          following documents, electronically stored information, or objects, and to permit inspection, copying, testing, or
          sampling of the material:
        </p>
        {!inspection && (
          <>
            {requestType && <p className="sf-filled sf-kind">{SUBPOENA_TYPE_LABEL[requestType]}</p>}
            {what}
          </>
        )}
        <dl className="sf-where">
          <div>
            <dt>Place:</dt>
            <dd className="sf-filled">{production ? office : ''}</dd>
          </div>
          <div>
            <dt>Date and Time:</dt>
            <dd className="sf-filled">{production ? when : ''}</dd>
          </div>
        </dl>
      </div>

      <div className="sf-command">
        <p>
          <span className="sf-box" role="img" aria-label={inspection ? 'Checked' : 'Not checked'}>
            {inspection ? '✕' : ''}
          </span>
          <em>Inspection of Premises:</em> <strong>YOU ARE COMMANDED</strong> to permit entry onto the designated premises,
          land, or other property possessed or controlled by you at the time, date, and location set forth below, so that the
          requesting party may inspect, measure, survey, photograph, test, or sample the property or any designated object or
          operation on it.
        </p>
        {inspection && what}
        <dl className="sf-where">
          <div>
            <dt>Place:</dt>
            <dd className="sf-filled">{inspection ? `Premises of ${recipient.trim() || 'the recipient'}` : ''}</dd>
          </div>
          <div>
            <dt>Date and Time:</dt>
            <dd className="sf-filled">{inspection ? when : ''}</dd>
          </div>
        </dl>
      </div>

      <p className="sf-rules">
        The following provisions of Fed. R. Civ. P. 45 are attached – Rule 45(c), relating to the place of compliance; Rule
        45(d), relating to your protection as a person subject to a subpoena; and Rule 45(e) and (g), relating to your duty to
        respond to this subpoena and the potential consequences of not doing so.
      </p>

      <div className="sf-sign">
        <p>
          Date: <span className="sf-filled sf-line sf-inline">{formDate(servedAt ?? new Date().toISOString())}</span>
        </p>
        <div className="sf-signatures">
          <div>
            <p className="sf-clerk-head">CLERK OF COURT</p>
            <p className="sf-filled sf-line sf-signature">/s/ {court.clerk}</p>
            <small>Signature of Clerk or Deputy Clerk</small>
          </div>
          <p className="sf-or">OR</p>
          <div>
            <p className="sf-filled sf-line sf-signature">{attorney ? `/s/ ${attorney}` : blank}</p>
            <small>Attorney&rsquo;s signature</small>
          </div>
        </div>
      </div>

      <p className="sf-attorney">
        The name, address, e-mail address, and telephone number of the attorney representing <em>(name of party)</em>{' '}
        <span className="sf-filled">{party}</span>, who issues or requests this subpoena, are:{' '}
        <span className="sf-filled">
          {[attorney, firm.firm || `Counsel for ${party}`].filter(Boolean).join(', ')}
        </span>
      </p>

      <footer className="sf-notice">
        <h5>Notice to the person who issues or requests this subpoena</h5>
        <p>
          If this subpoena commands the production of documents, electronically stored information, or tangible things or the
          inspection of premises before trial, a notice and a copy of the subpoena must be served on each party in this case
          before it is served on the person to whom it is directed. Fed. R. Civ. P. 45(a)(4).
        </p>
      </footer>
    </article>
  )
}
