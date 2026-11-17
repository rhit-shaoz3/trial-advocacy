import type { ReactNode } from 'react'
import type { SetupStep } from '../../../courses/types'
import type { ExchangeStep } from '../exchange/ExchangeSetupFlow'

// What each setup step is for and the instructor's options, opened from the
// step's "What is this step for?" link. Keep each to a few short lines.

export const SETUP_HELP: Record<SetupStep, ReactNode> = {
  details: (
    <ul>
      <li>The title and description are the first thing students see when the case launches.</li>
      <li>Name the plaintiff and defendant. The AI witnesses, investigator and welcome emails use these names.</li>
      <li>You can change all of it later from the case page.</li>
    </ul>
  ),
  facts: (
    <ul>
      <li>
        These are the facts of the case each side relies on. The AI witnesses and the investigator never contradict
        them, so teams can&rsquo;t talk a witness out of them.
      </li>
      <li>Students never see this list. It only steers the AI.</li>
      <li>Keep each fact to one line. The case needs at least one for each side before it can launch.</li>
    </ul>
  ),
  files: (
    <ul>
      <li>
        <strong>The initial file</strong> is what every team starts from, usually the complaint or fact pattern. The
        case can&rsquo;t launch without one.
      </li>
      <li>
        <strong>Who sees each file:</strong> everyone, one side only, or instructors only. Instructors-only files
        (like a witness&rsquo;s deposition) train the AI and stay hidden until you share them, or a team earns them
        through a subpoena or the investigator.
      </li>
      <li>
        Give each file a clear label. Students see the label, and the AI uses it to cite the file. A long fact
        pattern works better split into sections.
      </li>
      <li>
        <strong>Owned by:</strong> who would really have the file. A third party (a hospital, the city) gives it up only
        to a subpoena or the investigator; a side&rsquo;s team, or one of its clients, can hand it over when the team
        emails its client.
      </li>
      <li>Files you add are uploaded when you press Next, or with the Upload button.</li>
    </ul>
  ),
  teams: (
    <ul>
      <li>Students work the case in teams. A team can be one student or several.</li>
      <li>Drag students onto teams, or auto-pair them at the size you choose. Auto-pair avoids earlier partners.</li>
      <li>You can move students between teams later, even after the case starts.</li>
    </ul>
  ),
  worlds: (
    <ul>
      <li>
        A case world puts one plaintiff team against one defense team. They exchange discovery with each other and
        depose each other&rsquo;s witnesses.
      </li>
      <li>
        Each world plays out on its own. Its subpoena responses, investigator findings and new facts don&rsquo;t
        reach the other worlds.
      </li>
      <li>Auto-match avoids earlier opponents and gives each team the side it has argued less.</li>
    </ul>
  ),
  witnesses: (
    <ul>
      <li>Every witness here shows to both sides, in the students&rsquo; Witnesses tab.</li>
      <li>
        <strong>AI witnesses:</strong> give a witness the side they testify for and a deposition file. Their own
        side can interview them from the start; the other side deposes them in the deposition phase.
      </li>
      <li>
        <strong>Show to students:</strong> turn it off to keep a witness back until you&rsquo;re ready. A hidden
        witness you pick for initial disclosures is shown when the introduction ends.
      </li>
      <li>Persona notes shape how the witness talks. Their lawyer&rsquo;s name is who objects in a deposition.</li>
      <li>
        <strong>Clients:</strong> mark a side&rsquo;s clients, and that team can email them for information. Several
        clients answer together, from anything any of them knows or owns. When nothing they own covers a request, they
        write out the document, for you to review. &ldquo;Emails to the client&rdquo; limits how many each team (or
        student) can send: two per team unless you change it.
      </li>
      <li>
        <strong>Interviews with each witness:</strong> how many times each team (or each student) can interview each
        witness, depositions included. Two per team unless you change it.
      </li>
    </ul>
  ),
  investigator: (
    <ul>
      <li>
        In the investigate phase, teams email the investigator assignments: find people, search public records,
        watch someone, inspect the scene. He writes back a report.
      </li>
      <li>
        You review each report before the team sees it. In review lite, set on the Review page, reports go straight
        to the team.
      </li>
      <li>Turn him off and the case skips the investigate phase.</li>
      <li>
        <strong>Requests:</strong> how many assignments each team (or each student) can send him. Two per team unless
        you change it.
      </li>
      <li>Your instructions change how he works, and they come before his standard instructions.</li>
    </ul>
  ),
  tasks: (
    <ul>
      <li>Tasks are the assignments teams see on their dashboard, with due dates.</li>
      <li>Give a task to everyone or to one side. Either partner can mark it done for the team.</li>
      <li>Discovery deadlines from information exchange appear as tasks on their own.</li>
    </ul>
  ),
}

export const EXCHANGE_HELP: Record<ExchangeStep, ReactNode> = {
  disclosures: (
    <ul>
      <li>
        Initial disclosures (FRCP 26(a)(1)) are the witnesses and documents each side must name to the other early.
        In the introduction phase, each student picks their own as practice.
      </li>
      <li>
        Your picks are the answer key. When you move to information exchange, students see how theirs compare, and
        your picks are shared with the other side.
      </li>
      <li>
        Documents a team got from its clients or the investigator belong to its case world. You can add them to that
        world&rsquo;s disclosures; they&rsquo;re listed under the world. That team can pick them in its own practice
        too.
      </li>
      <li>Turn this part off to skip the practice. Teams then start straight from requests.</li>
    </ul>
  ),
  subpoenas: (
    <ul>
      <li>
        A subpoena gets records, data, objects or a site visit from someone outside the case, like a hospital or an
        employer. Choose which kinds teams can ask for.
      </li>
      <li>
        The AI drafts the recipient&rsquo;s response from the case file, and you approve or edit it before the team
        sees it (in review lite, it goes straight to the team).
      </li>
      <li>AI feedback checks a team&rsquo;s draft before they serve it, for as many rounds as you allow.</li>
    </ul>
  ),
  interrogatories: (
    <ul>
      <li>
        Written questions one team sends the other, answered in writing within the days you set. Each subpart counts
        toward the limit, as under FRCP 33.
      </li>
      <li>AI feedback checks the questions and the answers before they&rsquo;re sent.</li>
    </ul>
  ),
  rfas: (
    <ul>
      <li>
        Statements one team asks the other to admit or deny (FRCP 36). What&rsquo;s admitted is settled, so it
        doesn&rsquo;t have to be proven at trial.
      </li>
      <li>AI feedback checks the requests and the responses before they&rsquo;re sent.</li>
    </ul>
  ),
  email: (
    <ul>
      <li>
        Each team&rsquo;s first message, from a senior partner at their law firm: what the case is, who the client
        is, and what to do first.
      </li>
      <li>Name each side&rsquo;s firm and partner. The documents and witnesses fill in from the case.</li>
    </ul>
  ),
  review: (
    <ul>
      <li>Look over each part before you finish. Any part can be changed later from the case page.</li>
    </ul>
  ),
}
