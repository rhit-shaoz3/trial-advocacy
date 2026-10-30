import type { CasePhase, CourseCaseStatus } from '../courses/types'
import type { Tour, TourStep } from './tourTypes'

// The guided tours, page by page. Keep each step to a sentence or two: what
// it is, why you'd care, and where to find it again.

const launcherStep: TourStep = {
  target: '[data-tour-launcher]',
  title: 'Lost? I live here',
  body: 'Click Take the tour anytime to replay the tour for the page you’re on.',
}

const nav = (id: string) => `[data-tour="nav-${id}"]`
const section = (headingId: string) => `section[aria-labelledby="${headingId}"]`

export const STUDENT_HOME: Tour = {
  key: 'student-home',
  title: 'Welcome',
  steps: [
    {
      title: 'Welcome to Getting to Trial! ⚖️',
      body: 'This is where you practice pretrial work: interviewing witnesses, trading discovery, and building your case. Here’s a quick lap around.',
    },
    {
      target: '.course-card',
      title: 'Your courses',
      body: 'Each card is a course. Open one to find your cases, deadlines, and team.',
    },
    {
      target: '[data-tour="enroll"]',
      title: 'Got an entry code?',
      body: 'Your instructor hands it out. Pop it in here to join their course.',
    },
    launcherStep,
  ],
}

export const INSTRUCTOR_HOME: Tour = {
  key: 'instructor-home',
  title: 'Welcome',
  steps: [
    {
      title: 'Welcome to Getting to Trial! ⚖️',
      body: 'Build fact patterns, pair students into teams, and judge what their AI witnesses say. Here’s where everything lives.',
    },
    {
      target: '.course-card',
      title: 'Your courses',
      body: 'One card per course. Open one for its cases, calendar, review queue, and roster.',
    },
    {
      target: '[data-tour="create-course"]',
      title: 'New term, new course',
      body: 'Create a course to get an entry code for your students.',
    },
    launcherStep,
  ],
}

export const STUDENT_COURSE: Tour = {
  key: 'student-course',
  title: 'Course tour',
  steps: [
    {
      target: nav('dashboard'),
      title: 'Home base',
      body: 'Your course dashboard: what’s new, what’s due, and where each case stands.',
    },
    {
      target: section('ws-cases-heading'),
      title: 'Your cases',
      body: 'Each card shows how far along a case is. Enter one to get to work.',
    },
    {
      target: section('ws-upcoming-heading'),
      title: 'Coming up',
      body: 'Deadlines and case dates, soonest first, so nothing sneaks up on you.',
      ifMissing: 'skip',
    },
    { target: nav('cases'), title: 'My cases', body: 'Every case you’re on, in one list.' },
    { target: nav('calendar'), title: 'Calendar', body: 'Tasks, case dates, and your own events, by month.' },
    launcherStep,
  ],
}

export const INSTRUCTOR_COURSE: Tour = {
  key: 'instructor-course',
  title: 'Course tour',
  steps: [
    {
      target: '.ws-stats',
      title: 'The course at a glance',
      body: 'Active cases, teams, and what’s waiting on you.',
    },
    {
      target: section('ws-attention-heading'),
      title: 'Needs your attention',
      body: 'Anything waiting on you, with a link straight to it.',
      ifMissing: 'skip',
    },
    {
      target: section('ws-monitor-heading'),
      title: 'Case monitor',
      body: 'Where each case stands. It nudges you when a case looks ready for its next phase.',
    },
    { target: nav('cases'), title: 'Cases', body: 'Build a case, set up its exchange, and move it through its phases.' },
    {
      target: nav('review'),
      title: 'Review',
      body: 'You’re the judge: rule on the new facts AI witnesses add and the subpoenas teams serve. The badge counts what’s waiting.',
    },
    { target: nav('calendar'), title: 'Calendar', body: 'Due dates and the case dates you set for everyone.' },
    { target: nav('manage'), title: 'Manage course', body: 'Your roster, the entry code, and the course details.' },
    launcherStep,
  ],
}

export const STUDENT_CALENDAR: Tour = {
  key: 'student-calendar',
  title: 'Calendar tour',
  steps: [
    {
      target: '.cal-filters',
      title: 'Pick what shows',
      body: 'Turn tasks, case dates, and your own events on or off.',
    },
    {
      target: '.cal-grid',
      title: 'The month',
      body: 'Click a day’s number to add an event. Share one with your team for a study session.',
    },
    { target: section('cal-agenda-title'), title: 'This month, as a list', body: 'Everything coming up, in order.' },
  ],
}

export const INSTRUCTOR_CALENDAR: Tour = {
  key: 'instructor-calendar',
  title: 'Calendar tour',
  steps: [
    {
      target: '.cal-filters',
      title: 'Pick what shows',
      body: 'Task due dates, case dates, and your own events.',
    },
    {
      target: '.cal-grid',
      title: 'The month',
      body: 'Click a day’s number to add a date. Case dates show up for everyone in that case.',
    },
    { target: section('cal-agenda-title'), title: 'This month, as a list', body: 'Everything coming up, in order.' },
  ],
}

export const STUDENT_CASES: Tour = {
  key: 'student-cases',
  title: 'Cases tour',
  steps: [
    {
      target: '.case-list',
      title: 'Your cases',
      body: 'Every case you’re on, with its phase. Your instructor pairs you with a partner for each one.',
    },
  ],
}

export const INSTRUCTOR_CASES: Tour = {
  key: 'instructor-cases',
  title: 'Cases tour',
  steps: [
    {
      target: '.case-list',
      title: 'Every case in the course',
      body: 'Each one is shared by the whole class, with students paired into teams.',
      ifMissing: 'skip',
    },
    {
      target: '[data-tour="new-case"]',
      title: 'Start a new case',
      body: 'Upload a complaint and the guided setup suggests witnesses, files, and tasks for you.',
    },
  ],
}

export const INSTRUCTOR_CASE: Tour = {
  key: 'instructor-case',
  title: 'Case tour',
  steps: [
    {
      target: '.launch-panel',
      title: 'Ready for launch?',
      body: 'The checklist shows what’s left before students can see the case.',
      ifMissing: 'skip',
    },
    {
      target: '.phase-panel',
      title: 'Phases',
      body: 'A case moves from introduction to deposition. Move it forward when teams are ready; each phase unlocks new tools for them.',
      ifMissing: 'skip',
    },
    {
      target: '.ws-main > * > .exchange-card, .page > .exchange-card',
      title: 'What this phase needs from you',
      body: 'Set up the exchange, watch subpoenas, or check on depositions, depending on the phase.',
      ifMissing: 'skip',
    },
    {
      target: '.case-actions',
      title: 'Edit, duplicate, share',
      body: 'Copy a case for next term, or share it with a colleague.',
      ifMissing: 'skip',
    },
    { target: '#case-tab-teams', title: 'Teams & worlds', body: 'Who’s paired with whom, and which case world each team plays in.' },
    { target: '#case-tab-materials', title: 'Case file', body: 'Your files, and who can see each one.' },
    { target: '#case-tab-witnesses', title: 'Witnesses', body: 'The AI witnesses, their sides, and what they know.' },
    {
      target: '#case-tab-investigator',
      title: 'Investigator',
      body: 'What the background investigator can and can’t dig up for teams.',
      ifMissing: 'skip',
    },
    {
      target: '#case-tab-exchange',
      title: 'Information exchange',
      body: 'Every subpoena, interrogatory, and request teams trade, and the limits you set.',
      ifMissing: 'skip',
    },
    { target: '#case-tab-tasks', title: 'Tasks', body: 'Assignments and due dates for every team.' },
    {
      target: '#case-tab-student-view',
      title: 'Student view',
      body: 'See exactly what a team sees. Great for a sanity check before class.',
      ifMissing: 'skip',
    },
  ],
}

export const INSTRUCTOR_REVIEW: Tour = {
  key: 'instructor-review',
  title: 'Review tour',
  steps: [
    {
      title: 'Order in the court 🧑‍⚖️',
      body: 'When an AI witness adds a fact, you decide whether it stands. Here’s your bench.',
    },
    {
      target: '.review-tabs',
      title: 'To review, and done',
      body: 'Work through what’s waiting. Changed your mind? Completed reviews let you change a ruling.',
    },
    {
      target: '.review-queue',
      title: 'The queue',
      body: 'Student flags first, then subpoenas, then similar facts from different teams (rule once for all), then interviews and reports.',
    },
    {
      target: '.facts-panel',
      title: 'New facts',
      body: 'Every fact ruled so far, by case world, so your rulings stay consistent.',
      ifMissing: 'skip',
    },
    {
      target: '.review-lite',
      title: 'Review lite',
      body: 'Short on time? Turn it on and the AI’s calls stand at once. You only see what students flag.',
      ifMissing: 'skip',
    },
  ],
}

const tab = (id: string) => `#cw-tab-${id}`

/** The tabs of a student's case, for the first time in any case. */
const CASE_STEPS: TourStep[] = [
  {
    title: 'Welcome to your case! 🗂️',
    body: 'Everything for this case lives here. Here’s a quick walk through the tabs.',
  },
  {
    target: '.cw-banner',
    title: 'Cases move in phases',
    body: 'New tools unlock as your instructor moves the case along. You’ll get a short tour each time.',
    go: { tab: 'overview' },
    ifMissing: 'skip',
  },
  {
    target: section('cw-workbench'),
    title: 'Your workbench',
    body: 'Shortcuts to everything you can do right now.',
    go: { tab: 'overview' },
    ifMissing: 'skip',
  },
  { target: tab('case-file'), title: 'Case file', body: 'The documents. Look for Start here: it’s the one to read first.' },
  {
    target: tab('witnesses'),
    title: 'Witnesses',
    body: 'Interview your side’s witnesses. They only know what they know, so ask good questions.',
  },
  {
    target: tab('exchange'),
    title: 'Information exchange',
    body: 'Disclosures, subpoenas, interrogatories, and requests for admission, sent and received.',
    ifMissing: 'skip',
  },
  {
    target: tab('investigator'),
    title: 'Investigator',
    body: 'A background investigator who digs up records for you, once the investigate phase opens.',
    ifMissing: 'skip',
  },
  { target: tab('tasks'), title: 'Tasks', body: 'What’s due, and when. Tick them off as your team finishes.' },
  {
    target: tab('reviews'),
    title: 'Reviews',
    body: 'Your instructor’s rulings on the facts your witnesses added.',
    ifMissing: 'skip',
  },
]

/** What's new in each phase, as a team finds it. */
const PHASE_STEPS: Record<CasePhase, TourStep[]> = {
  introduction: [
    {
      target: '[data-tour="ex-menu-disclosures"]',
      title: 'First up: initial disclosures',
      body: 'Pick the witnesses and files you’ll share with the other side. Theirs come later.',
      go: { tab: 'exchange', section: 'disclosures' },
      ifMissing: 'skip',
    },
    {
      target: '[data-tour="ex-teach"]',
      title: 'New to discovery?',
      body: 'Teach me explains each part in plain English, with examples.',
      go: { tab: 'exchange', section: 'disclosures' },
      ifMissing: 'skip',
    },
    {
      target: tab('witnesses'),
      title: 'Meet your witnesses',
      body: 'You can interview your own side’s witnesses now. The other side’s come later.',
      go: { tab: 'witnesses' },
    },
  ],
  information_exchange: [
    {
      target: '.ex-menu',
      title: 'Discovery is open! 📬',
      body: 'Subpoenas, interrogatories, and requests for admission just unlocked.',
      go: { tab: 'exchange', section: 'interrogatories' },
    },
    {
      target: '[data-tour="ex-write"]',
      title: 'Write a set',
      body: 'Start your questions here. Before you send, Check with AI gives you a few rounds of hints.',
      go: { tab: 'exchange', section: 'interrogatories' },
      ifMissing: 'skip',
    },
    {
      target: '.ex-remaining',
      title: 'Count your questions',
      body: 'Your instructor sets a limit. Each subpart counts, so make them work.',
      go: { tab: 'exchange', section: 'interrogatories' },
      ifMissing: 'skip',
    },
    {
      target: '.ex-drafts',
      title: 'Drafts save themselves',
      body: 'Unsent work is saved as you type and shared with your team, so anyone can pick up where you left off. They’ll show up on this page once you start one.',
      go: { tab: 'exchange', section: 'interrogatories' },
      ifMissing: 'center',
    },
    {
      target: section('ex-interrogatories-respond'),
      title: 'Requests to answer',
      body: 'When the other team sends you a set, it lands here with a Respond button. Watch the due date!',
      go: { tab: 'exchange', section: 'interrogatories' },
      ifMissing: 'center',
    },
    {
      target: section('ex-interrogatories-history'),
      title: 'Their answers',
      body: 'Sets you’ve sent live here, and their responses show up here once they answer. The tab’s badge tells you when.',
      go: { tab: 'exchange', section: 'interrogatories' },
      ifMissing: 'center',
    },
    {
      target: '[data-tour="ex-menu-subpoenas"]',
      title: 'Subpoenas',
      body: 'Need records from someone outside the case? Serve a subpoena. Their response comes back here.',
      go: { tab: 'exchange', section: 'subpoenas' },
      ifMissing: 'skip',
    },
    {
      target: tab('witnesses'),
      title: 'Disclosed witnesses',
      body: 'The other side’s disclosed witnesses appear here now. You can’t interview them yet.',
    },
  ],
  investigate: [
    {
      target: tab('investigator'),
      title: 'Your investigator is in 🔎',
      body: 'Send an assignment by email and get a report back on records, backgrounds, and more.',
      go: { tab: 'investigator' },
      ifMissing: 'skip',
    },
    {
      target: 'form.cw-email',
      title: 'Ask for what you need',
      body: 'Be specific: who, what, and why it matters. The clearer the ask, the better the report.',
      go: { tab: 'investigator' },
      ifMissing: 'skip',
    },
    {
      target: tab('case-file'),
      title: 'Reports land in your case file',
      body: 'Finished reports, and any records that come with them, also show up here.',
    },
  ],
  deposition: [
    {
      target: tab('witnesses'),
      title: 'Depositions! 🎤',
      body: 'Every witness is open now, including the other side’s. Time to pin down their story.',
      go: { tab: 'witnesses' },
    },
    {
      target: '.cw-interview:not(.cw-interview-off)',
      title: 'Depose away',
      body: 'Start a deposition here. Bring your exhibits; you can show a witness a document mid-interview.',
      go: { tab: 'witnesses' },
      ifMissing: 'skip',
    },
  ],
}

const PHASE_TITLE: Record<CasePhase, string> = {
  introduction: 'Introduction',
  information_exchange: 'Information exchange',
  investigate: 'Investigate',
  deposition: 'Deposition',
}

export const phaseTourKey = (caseId: string, phase: CasePhase) => `phase:${caseId}:${phase}`

/** The full case tour: every tab, then what the current phase brings. */
export function caseTour(caseId: string, phase: CasePhase): Tour {
  return {
    key: 'student-case',
    title: 'Case tour',
    steps: [...CASE_STEPS, ...PHASE_STEPS[phase], launcherStep],
    alsoMarks: [phaseTourKey(caseId, phase)],
  }
}

/** A case's new phase: what just opened, and where to find it. */
export function phaseTour(caseId: string, phase: CasePhase): Tour {
  return {
    key: phaseTourKey(caseId, phase),
    title: `${PHASE_TITLE[phase]} phase`,
    steps: [
      {
        title: `New phase! 🎉`,
        body: `${PHASE_TITLE[phase]} is open. Here’s what that means for your team.`,
      },
      ...PHASE_STEPS[phase],
    ],
  }
}

/**
 * A student's case page tours. The tour button always replays the whole case
 * tour (every tab, then the current phase). On its own, the first time in any
 * case, that whole tour starts; after that, a short tour each time this case
 * moves to a phase they haven't seen in it. A closed case starts nothing.
 */
export function pickCaseTour(
  seen: (key: string) => boolean,
  caseId: string,
  phase: CasePhase,
  status: CourseCaseStatus,
): { tour: Tour; startWith: Tour | null } {
  const full = caseTour(caseId, phase)
  if (status !== 'active') return { tour: full, startWith: null }
  if (!seen(full.key)) return { tour: full, startWith: full }
  if (!seen(phaseTourKey(caseId, phase))) return { tour: full, startWith: phaseTour(caseId, phase) }
  return { tour: full, startWith: null }
}
